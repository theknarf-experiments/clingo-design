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
// clingo-lpx is registered on every session, adding linear arithmetic over
// rationals through clingo's theory interface. Its variables are not stable
// model atoms, so their values cannot appear in an answer set on their own.
// `clingolpx_on_model` puts them there as `__lpx(Var,"Value")` — plus
// `__lpx_objective("Value",Bounded)` when the program has a `&minimize` — so
// callers see one uniform channel.
//
// That call is only safe because the solve is given an event handler. It works
// through `Model::extend`, which appends to a table clingo clears in its own
// `onModel` — and clingo only gets there when a handler was registered.
// Iterating a bare solve handle skips the clear, and the second model then
// comes back carrying the first one's values as well. The values also arrive
// under `ShowType::Theory` rather than `Shown`, which keeps them off the same
// list as the program's own atoms.
//
// Results are printed to stdout as one line of JSON, which the Emscripten
// runtime routes to Module.print.
#include <clingo-lpx.h>
#include <clingo.hh>

#include <cstdio>
#include <exception>
#include <map>
#include <memory>
#include <string>
#include <vector>

using namespace Clingo;

namespace {

//! Rewrites statements through clingo-lpx before handing them to the builder.
//!
//! Theory atoms have to be transformed before grounding, so the program cannot
//! simply be `add`ed as text the way it was before.
struct Rewriter {
    clingolpx_theory_t *theory;
    clingo_program_builder_t *builder;

    static bool add(clingo_ast_t *stm, void *data) {
        return clingo_program_builder_add(static_cast<clingo_program_builder_t *>(data), stm);
    }

    static bool rewrite(clingo_ast_t *stm, void *data) {
        auto *self = static_cast<Rewriter *>(data);
        return clingolpx_rewrite_ast(self->theory, stm, add, self->builder);
    }
};

//! Hands each model to clingo-lpx so it can attach its theory values.
struct LpxValues : SolveEventHandler {
    explicit LpxValues(clingolpx_theory_t *theory) : lpx{theory} {}
    bool on_model(Model &model) override {
        Detail::handle_error(clingolpx_on_model(lpx, model.to_c()));
        return true;
    }
    clingolpx_theory_t *lpx;
};

/**
 * clingo's own diagnostics: "atom does not occur in any rule head", an unsafe
 * variable, a `#show` for a predicate nothing derives.
 *
 * Both the parser and the grounder throw these away unless handed a logger, and
 * the parse call additionally took a message limit of zero — so a typo inside a
 * rule used to be perfectly silent. That matters here more than it would in a
 * library: the rules panel is a place people write ASP by hand, and a panel that
 * says nothing about a misspelled predicate is a panel that lies by omission.
 *
 * Written to stderr in clingo's own wording, deliberately. The message arrives
 * already carrying its location (`<block>:3:8-14: info: ...`), the Emscripten
 * runtime routes stderr to `printErr`, and `formatDiagnostics` on the far side
 * already parses exactly that shape to say "your rules, line 3". So the whole
 * channel exists; this only stops discarding what flows down it.
 */
constexpr unsigned MESSAGE_LIMIT = 20;

void log_message(Clingo::WarningCode, char const *message) {
    std::fprintf(stderr, "%s\n", message);
}

/** The same, in the shape `clingo_ast_parse_string` wants. */
void log_message_c(clingo_warning_t, char const *message, void *) {
    std::fprintf(stderr, "%s\n", message);
}

struct Session {
    explicit Session(std::vector<char const *> const &args)
        : ctl{StringSpan{args.data(), args.size()}, log_message, MESSAGE_LIMIT} {
        Detail::handle_error(clingolpx_create(&lpx));
    }
    ~Session() {
        if (lpx != nullptr) { clingolpx_destroy(lpx); }
    }
    Session(Session const &) = delete;
    Session &operator=(Session const &) = delete;

    Control ctl;
    clingolpx_theory_t *lpx{nullptr};
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
        Control &ctl = session->ctl;

        // Registering first: this is what installs the propagator and adds the
        // `#theory lp` definition the program is then parsed against.
        Detail::handle_error(clingolpx_register(session->lpx, ctl.to_c()));

        AST::with_builder(ctl, [&](AST::ProgramBuilder &builder) {
            Rewriter rewriter{session->lpx, builder.to_c()};
            Detail::handle_error(clingo_ast_parse_string(
                program, Rewriter::rewrite, &rewriter, ctl.to_c(), log_message_c, nullptr,
                MESSAGE_LIMIT));
        });

        ctl.ground({{"base", {}}});
        Detail::handle_error(clingolpx_prepare(session->lpx, ctl.to_c()));

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
 *
 * `bound` is a comma-separated cost ceiling, highest priority level first, and
 * it is what makes a ranked program still hold several answers: every model
 * whose cost vector is lexicographically at or under it is an answer, not only
 * the proven optima. Empty means the weak constraints are ignored entirely —
 * the deliberate default, because a program that ranks its models must not
 * thereby stop enumerating them. See `--opt-mode` in clingo's own manual; the
 * spelling `enum,<b1>,<b2>` was confirmed against this build.
 */
int cd_solve(int id, char const *mode, int models, char const *assumptions,
             char const *bound) {
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
        // Three ways to treat the program's weak constraints, and the default is
        // the one that leaves the answers alone. "opt" was the old default and
        // was a trap: with an optimize statement anywhere in the program it
        // walks *improving* models, so an enumeration that should have returned
        // a design space returned a shrinking chain of it instead.
        std::string bound_str = (bound != nullptr) ? bound : "";
        std::string opt_mode = opt_n              ? "optN"
                               : bound_str.empty() ? "ignore"
                                                   : "enum," + bound_str;
        conf["solve"]["opt_mode"] = opt_mode.c_str();

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
                    out += "\"modelCosts\":[],";
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
        // One cost vector per collected model, so a ranked answer can be shown
        // *as* a ranking. `costs` below is only ever the last model's, which for
        // an improving search is the best one and for a bounded enumeration is
        // whichever came last — no use to a caller that wants to order them.
        std::string costs_json = "[";
        bool first_model = true;
        long long seen = 0;
        std::vector<int64_t> costs;
        bool optimal = false;
        SolveResult result;
        std::vector<std::string> core;

        {
            LpxValues on_model{session->lpx};
            auto handle = ctl.solve(LiteralSpan{lits.data(), lits.size()}, &on_model);
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
                    if (!first_model) {
                        models_json += ",";
                        costs_json += ",";
                    }
                    first_model = false;
                    auto const &mc = model.cost();
                    costs_json += "[";
                    for (size_t i = 0; i < mc.size(); ++i) {
                        if (i != 0) { costs_json += ","; }
                        costs_json += std::to_string(mc[i]);
                    }
                    costs_json += "]";
                    models_json += "[";
                    bool first_symbol = true;
                    auto put = [&](std::string const &text) {
                        if (!first_symbol) { models_json += ","; }
                        first_symbol = false;
                        quote(text, models_json);
                    };
                    for (auto const &sym : model.symbols(ShowType::Shown)) {
                        put(sym.to_string());
                    }
                    // The theory values clingo-lpx attached above, in the same
                    // shape its own binary prints them.
                    for (auto const &sym : model.symbols(ShowType::Theory)) {
                        put(sym.to_string());
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
        costs_json += "]";

        std::string out = "{\"result\":";
        quote(result.is_satisfiable()     ? "SATISFIABLE"
              : result.is_unsatisfiable() ? "UNSATISFIABLE"
                                          : "UNKNOWN",
              out);
        out += ",\"models\":" + models_json;
        out += ",\"modelCosts\":" + costs_json;
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
