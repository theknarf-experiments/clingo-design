cmake_minimum_required(VERSION 3.10)
project(clingo_design C CXX)

# clasp still uses std::unary_function, which C++17 removed, so the default
# stays at 14 and only clingo-lpx's own sources are raised (see below).
set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# CLINGO_SOURCE_DIR points at the vendored checkout; it stays pristine, so this
# wrapper project owns the entry point instead of patching upstream.
if (NOT DEFINED CLINGO_VENDOR_DIR)
    message(FATAL_ERROR "CLINGO_VENDOR_DIR must point at the clingo checkout")
endif()
if (NOT DEFINED CLINGO_LPX_VENDOR_DIR)
    message(FATAL_ERROR "CLINGO_LPX_VENDOR_DIR must point at the clingo-lpx checkout")
endif()

# Emscripten's linker chokes on response files for the object/library lists.
# Upstream does this inside its own CMakeLists when CLINGO_BUILD_WEB is on;
# repeat it here so it also applies to this project's own target.
unset(CMAKE_C_USE_RESPONSE_FILE_FOR_LIBRARIES)
unset(CMAKE_CXX_USE_RESPONSE_FILE_FOR_LIBRARIES)
unset(CMAKE_C_USE_RESPONSE_FILE_FOR_OBJECTS)
unset(CMAKE_CXX_USE_RESPONSE_FILE_FOR_OBJECTS)
unset(CMAKE_C_USE_RESPONSE_FILE_FOR_INCLUDES)
unset(CMAKE_CXX_USE_RESPONSE_FILE_FOR_INCLUDES)

add_subdirectory("${CLINGO_VENDOR_DIR}" clingo)

# ---------------------------------------------------------------------------
# clingo-lpx: linear arithmetic over rationals, as a theory propagator.
#
# Built from its sources rather than through its own CMakeLists, which always
# wants find_package(Clingo) and always builds the standalone binary. Neither
# applies here: libclingo is already a target above, and the binary needs an
# entry point this module does not have.
# ---------------------------------------------------------------------------

# Arbitrary-precision rationals. imath is two portable C files, which is why
# it works here at all — the alternative backend, FLINT, is a native library.
add_library(libimath STATIC
    "${CLINGO_LPX_VENDOR_DIR}/third_party/imath/imath.c"
    "${CLINGO_LPX_VENDOR_DIR}/third_party/imath/imrat.c")
target_include_directories(libimath PUBLIC
    "${CLINGO_LPX_VENDOR_DIR}/third_party/imath")

add_library(libclingo-lpx STATIC
    "${CLINGO_LPX_VENDOR_DIR}/libclingo-lpx/src/clingo-lpx.cc"
    "${CLINGO_LPX_VENDOR_DIR}/libclingo-lpx/src/parsing.cc"
    "${CLINGO_LPX_VENDOR_DIR}/libclingo-lpx/src/problem.cc"
    "${CLINGO_LPX_VENDOR_DIR}/libclingo-lpx/src/solving.cc"
    "${CLINGO_LPX_VENDOR_DIR}/libclingo-lpx/src/tableau.cc")
target_include_directories(libclingo-lpx PUBLIC
    "${CLINGO_LPX_VENDOR_DIR}/libclingo-lpx")
# Its own sources need C++17; the rest of the build cannot have it.
set_target_properties(libclingo-lpx PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
target_compile_definitions(libclingo-lpx
    PRIVATE CLINGOLPX_BUILD_LIBRARY
    # imath rather than FLINT, and no shared_mutex: this target is built
    # without threads, so the locking it would guard cannot happen.
    PUBLIC CLINGOLPX_USE_IMATH CLINGOLPX_NO_SHARED_MUTEX)
target_link_libraries(libclingo-lpx PUBLIC libclingo libimath)

add_executable(clingo_design
    # Upstream's one-shot entry, kept so `run(program, options)` stays available.
    "${CLINGO_VENDOR_DIR}/app/web/main.cc"
    # Persistent sessions: ground once, solve many times under assumptions.
    "${CMAKE_CURRENT_SOURCE_DIR}/session.cc"
)

target_link_libraries(clingo_design PRIVATE libclingo libgringo libclasp libclingo-lpx)

target_include_directories(clingo_design PRIVATE
    "${CLINGO_VENDOR_DIR}/libgringo"
    "${CLINGO_VENDOR_DIR}/clasp/app"
)

set_target_properties(clingo_design PROPERTIES
    OUTPUT_NAME "clingo"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set_target_properties(clingo_design PROPERTIES LINK_FLAGS
    "-sEXPORTED_FUNCTIONS=_run,_cd_open,_cd_solve,_cd_externals,_cd_configure,_cd_close,_cd_session_count,_memset,_malloc,_free -sEXPORTED_RUNTIME_METHODS=ccall")
