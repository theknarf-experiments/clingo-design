// Persistent-session bindings over libclingo's C++ API.
//
// Upstream's `web` target only exposes one-shot `run(program, options)`, which
// re-grounds on every call. These bindings keep a `Control` alive so a program
// is grounded once and then solved repeatedly under different *assumptions* —
// which is what makes sampling a large design space interactive rather than a
// re-grounding per query.
//
// Two things fall out of that for free:
//   * `enum_mode` can be switched between solves (brave / cautious) without
//     re-grounding, so the certainty overlay costs one solve, not one build.
//   * an unsatisfiable solve returns its *core*: the subset of the caller's
//     assumptions that actually conflict.
//
// Results are printed to stdout as one line of JSON, which the Emscripten
// runtime routes to Module.print.
#include <clingo.hh>

#include <cstdio>
#include <exception>
#include <map>
#include <memory>
#include <string>
#include <vector>

using namespace Clingo;

namespace {

struct Session {
    explicit Session(std::vector<char const *> const &args)
        : ctl{StringSpan{args.data(), args.size()}} {}
    Control ctl;
};

std::map<int, std::unique_ptr<Session>> g_sessions;
int g_next_id = 1;

Session *find_session(int id) {
    auto it = g_sessions.find(id);
    return it == g_sessions.end() ? nullptr : it->second.get();
}

void escape(std::string const &in, std::string &out) {
    for (char c : in) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x",
                                  static_cast<unsigned>(static_cast<unsigned char>(c)));
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
}

void quote(std::string const &in, std::string &out) {
    out += '"';
    escape(in, out);
    out += '"';
}

std::vector<std::string> split(char const *text, char sep) {
    std::vector<std::string> out;
    if (text == nullptr) { return out; }
    std::string cur;
    for (char const *p = text; *p != '\0'; ++p) {
        if (*p == sep) {
            if (!cur.empty()) { out.push_back(cur); }
            cur.clear();
        } else {
            cur += *p;
        }
    }
    if (!cur.empty()) { out.push_back(cur); }
    return out;
}

void emit(std::string const &json) { std::printf("%s\n", json.c_str()); }

void emit_error(std::string const &message) {
    std::string out = "{\"error\":";
    quote(message, out);
    out += "}";
    emit(out);
}

} // namespace

extern "C" {

/**
 * Creates a control from space-separated `options`, adds `program` and grounds
 * it. Returns a session id, or -1 after printing `{"error":...}`.
 */
int cd_open(char const *program, char const *options) {
    try {
        auto parts = split(options, ' ');
        std::vector<char const *> argv;
        argv.reserve(parts.size());
        for (auto const &part : parts) { argv.push_back(part.c_str()); }

        std::unique_ptr<Session> session(new Session(argv));
        session->ctl.add("base", {}, program);
        session->ctl.ground({{"base", {}}});

        int id = g_next_id++;
        g_sessions[id] = std::move(session);
        return id;
    } catch (std::exception const &e) {
        emit_error(e.what());
        return -1;
    } catch (...) {
        emit_error("unknown error while grounding");
        return -1;
    }
}

/**
 * Solves the already-grounded program.
 *
 * `mode` is auto | brave | cautious | count | optN. "count" enumerates without
 * collecting symbols, for sizing a space cheaply; "optN" enumerates only
 * proven optima of the program's weak constraints. `models` caps enumeration
 * (0 = all). `assumptions` is a newline-separated list of signed terms, e.g.
 * "+pick(tok(accent),0)\n-pick(tok(accent),1)" — newline because an ASP string
 * literal can contain ';' but never a raw newline.
 */
int cd_solve(int id, char const *mode, int models, char const *assumptions) {
    Session *session = find_session(id);
    if (session == nullptr) {
        emit_error("no such session");
        return -1;
    }
    try {
        Control &ctl = session->ctl;
        auto conf = ctl.configuration();
        conf["solve"]["models"] = std::to_string(models < 0 ? 0 : models).c_str();
        std::string mode_str = (mode != nullptr && *mode != '\0') ? mode : "auto";
        bool collect = mode_str != "count";
        // optN enumerates *only* proven optima; plain "opt" walks improving
        // models and never sets optimality_proven on any of them.
        bool opt_n = mode_str == "optN";
        bool enumerating = collect && !opt_n;
        conf["solve"]["enum_mode"] = enumerating ? mode_str.c_str() : "auto";
        conf["solve"]["opt_mode"] = opt_n ? "optN" : "opt";

        // Assumptions are mapped to program literals rather than passed as
        // symbols, so that an unsat core can be translated back into the
        // caller's own terms.
        std::vector<literal_t> lits;
        std::map<literal_t, std::string> origin;
        auto atoms = ctl.symbolic_atoms();

        for (auto const &token : split(assumptions, '\n')) {
            bool positive = token[0] != '-';
            std::string text = (token[0] == '+' || token[0] == '-') ? token.substr(1) : token;
            Symbol sym = parse_term(text.c_str());
            auto found = atoms.find(sym);
            if (found == atoms.end()) {
                // The atom does not occur in the grounding at all. Requiring it
                // is unsatisfiable on its own; forbidding it is free.
                if (positive) {
                    std::string out = "{\"result\":\"UNSATISFIABLE\",\"models\":[],";
                    out += "\"exhausted\":true,\"optimal\":false,\"costs\":[],\"core\":[";
                    quote(token, out);
                    out += "]}";
                    emit(out);
                    return 0;
                }
                continue;
            }
            literal_t lit = found->literal();
            literal_t signed_lit = positive ? lit : -lit;
            lits.push_back(signed_lit);
            origin[signed_lit] = token;
        }

        std::string models_json = "[";
        bool first_model = true;
        long long seen = 0;
        std::vector<int64_t> costs;
        bool optimal = false;
        SolveResult result;
        std::vector<std::string> core;

        {
            auto handle = ctl.solve(LiteralSpan{lits.data(), lits.size()});
            for (auto &model : handle) {
                // In optN clingo first *finds* the optimum and then enumerates
                // the optimal models, so the finding step would otherwise show
                // up as a duplicate.
                if (opt_n && !model.optimality_proven()) {
                    costs = model.cost();
                    continue;
                }
                ++seen;
                if (collect) {
                    if (!first_model) { models_json += ","; }
                    first_model = false;
                    models_json += "[";
                    bool first_symbol = true;
                    for (auto const &sym : model.symbols(ShowType::Shown)) {
                        if (!first_symbol) { models_json += ","; }
                        first_symbol = false;
                        quote(sym.to_string(), models_json);
                    }
                    models_json += "]";
                }
                costs = model.cost();
                optimal = model.optimality_proven();
            }
            result = handle.get();
            if (result.is_unsatisfiable()) {
                for (auto lit : handle.core()) {
                    auto it = origin.find(lit);
                    if (it != origin.end()) { core.push_back(it->second); }
                }
            }
        }
        models_json += "]";

        std::string out = "{\"result\":";
        quote(result.is_satisfiable()     ? "SATISFIABLE"
              : result.is_unsatisfiable() ? "UNSATISFIABLE"
                                          : "UNKNOWN",
              out);
        out += ",\"models\":" + models_json;
        out += ",\"count\":" + std::to_string(seen);
        out += ",\"exhausted\":";
        out += result.is_exhausted() ? "true" : "false";
        out += ",\"optimal\":";
        out += optimal ? "true" : "false";
        out += ",\"costs\":[";
        for (size_t i = 0; i < costs.size(); ++i) {
            if (i != 0) { out += ","; }
            out += std::to_string(costs[i]);
        }
        out += "],\"core\":[";
        for (size_t i = 0; i < core.size(); ++i) {
            if (i != 0) { out += ","; }
            quote(core[i], out);
        }
        out += "]}";
        emit(out);
        return 0;
    } catch (std::exception const &e) {
        emit_error(e.what());
        return -1;
    } catch (...) {
        emit_error("unknown error while solving");
        return -1;
    }
}

/**
 * Sets a solver configuration value by dot-separated path, e.g.
 * "solver.sign_def" or "solve.project". Applies between solves without
 * re-grounding. `solver` is an array of per-thread configurations; a name
 * following it is applied to every thread.
 */
int cd_configure(int id, char const *path, char const *value) {
    Session *session = find_session(id);
    if (session == nullptr) {
        emit_error("no such session");
        return -1;
    }
    try {
        auto keys = split(path, '.');
        if (keys.empty()) {
            emit_error("empty configuration path");
            return -1;
        }
        std::vector<Configuration> targets{session->ctl.configuration()};
        for (auto const &key : keys) {
            std::vector<Configuration> next;
            for (auto node : targets) {
                if (node.is_array()) {
                    for (size_t i = 0; i < node.size(); ++i) {
                        next.push_back(node[i][key.c_str()]);
                    }
                } else {
                    next.push_back(node[key.c_str()]);
                }
            }
            targets = next;
        }
        for (auto node : targets) { node = value; }
        std::string out = "{\"applied\":" + std::to_string(targets.size()) + "}";
        emit(out);
        return 0;
    } catch (std::exception const &e) {
        emit_error(e.what());
        return -1;
    } catch (...) {
        emit_error("unknown error while configuring");
        return -1;
    }
}

/**
 * Sets the truth of `#external` atoms, newline-separated and signed the same
 * way as assumptions; an unsigned entry releases the atom back to `free`.
 *
 * Unlike assumptions, an external's truth persists across solves, so a program
 * can carry state without being rebuilt. Nothing in the design tool declares
 * externals today; this is here for programs written by hand in the rules
 * panel.
 */
int cd_externals(int id, char const *atoms) {
    Session *session = find_session(id);
    if (session == nullptr) {
        emit_error("no such session");
        return -1;
    }
    try {
        int applied = 0;
        for (auto const &token : split(atoms, '\n')) {
            char sign = token[0];
            bool signed_entry = (sign == '+' || sign == '-');
            std::string text = signed_entry ? token.substr(1) : token;
            Symbol sym = parse_term(text.c_str());
            if (!signed_entry) {
                session->ctl.release_external(sym);
            } else {
                session->ctl.assign_external(
                    sym, sign == '+' ? TruthValue::True : TruthValue::False);
            }
            ++applied;
        }
        std::string out = "{\"applied\":" + std::to_string(applied) + "}";
        emit(out);
        return 0;
    } catch (std::exception const &e) {
        emit_error(e.what());
        return -1;
    } catch (...) {
        emit_error("unknown error while assigning externals");
        return -1;
    }
}

/** Releases a session. Grounded state is discarded. */
void cd_close(int id) { g_sessions.erase(id); }

/** Number of live sessions — used by tests to catch leaks. */
int cd_session_count() { return static_cast<int>(g_sessions.size()); }
}
