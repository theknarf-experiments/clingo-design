cmake_minimum_required(VERSION 3.10)
project(clingo_design CXX)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# CLINGO_SOURCE_DIR points at the vendored checkout; it stays pristine, so this
# wrapper project owns the entry point instead of patching upstream.
if (NOT DEFINED CLINGO_VENDOR_DIR)
    message(FATAL_ERROR "CLINGO_VENDOR_DIR must point at the clingo checkout")
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

add_executable(clingo_design
    # Upstream's one-shot entry, kept so `run(program, options)` stays available.
    "${CLINGO_VENDOR_DIR}/app/web/main.cc"
    # Persistent sessions: ground once, solve many times under assumptions.
    "${CMAKE_CURRENT_SOURCE_DIR}/session.cc"
)

target_link_libraries(clingo_design PRIVATE libclingo libgringo libclasp)

target_include_directories(clingo_design PRIVATE
    "${CLINGO_VENDOR_DIR}/libgringo"
    "${CLINGO_VENDOR_DIR}/clasp/app"
)

set_target_properties(clingo_design PROPERTIES
    OUTPUT_NAME "clingo"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set_target_properties(clingo_design PROPERTIES LINK_FLAGS
    "-sEXPORTED_FUNCTIONS=_run,_cd_open,_cd_solve,_cd_externals,_cd_configure,_cd_close,_cd_session_count,_memset,_malloc,_free -sEXPORTED_RUNTIME_METHODS=ccall")
