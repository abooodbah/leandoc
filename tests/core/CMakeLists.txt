set(LEANDOC_FIXTURES "${PROJECT_SOURCE_DIR}/tests/fixtures")

add_executable(leandoc_core_tests CoreTests.cpp TestZip.cpp)
target_compile_features(leandoc_core_tests PRIVATE cxx_std_17)
target_compile_options(leandoc_core_tests PRIVATE ${LEANDOC_CORE_WARNINGS})
target_include_directories(leandoc_core_tests PRIVATE "${LEANDOC_FIXTURES}")
target_link_libraries(leandoc_core_tests PRIVATE leandoc_core leandoc_vendor_config)
add_test(NAME leandoc-core COMMAND leandoc_core_tests "${LEANDOC_FIXTURES}")

# The command-line tool on one fixture: exit 0 and a report line.
add_test(
  NAME leandoc-inspect-smoke
  COMMAND "${CMAKE_COMMAND}"
          "-DINSPECT=$<TARGET_FILE:leandoc-inspect>"
          "-DFIXTURES=${LEANDOC_FIXTURES}"
          -P "${CMAKE_CURRENT_SOURCE_DIR}/InspectSmoke.cmake")

# Sanitized packages must open in LibreOffice. Runs only where soffice exists.
find_program(LEANDOC_SOFFICE NAMES soffice libreoffice)
if(LEANDOC_SOFFICE)
  add_test(
    NAME leandoc-sanitized-libreoffice
    COMMAND "${CMAKE_COMMAND}"
            "-DINSPECT=$<TARGET_FILE:leandoc-inspect>"
            "-DSOFFICE=${LEANDOC_SOFFICE}"
            "-DFIXTURES=${LEANDOC_FIXTURES}"
            "-DWORK=${CMAKE_CURRENT_BINARY_DIR}/libreoffice"
            -P "${CMAKE_CURRENT_SOURCE_DIR}/SanitizedLibreOffice.cmake")
  set_tests_properties(leandoc-sanitized-libreoffice PROPERTIES TIMEOUT 300)
endif()

# A libFuzzer harness for OpenDocumentBytes. Clang only.
option(LEANDOC_ENABLE_FUZZ "Build the libFuzzer harness (Clang only)" OFF)
if(LEANDOC_ENABLE_FUZZ)
  if(NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    message(FATAL_ERROR "LEANDOC_ENABLE_FUZZ needs Clang")
  endif()
  # Coverage feedback needs the core itself instrumented, not only the harness.
  target_compile_options(leandoc_core PRIVATE -fsanitize=fuzzer-no-link)
  add_executable(leandoc_fuzz_open FuzzOpen.cpp)
  target_compile_features(leandoc_fuzz_open PRIVATE cxx_std_17)
  target_compile_options(leandoc_fuzz_open PRIVATE -fsanitize=fuzzer)
  target_link_options(leandoc_fuzz_open PRIVATE -fsanitize=fuzzer)
  target_link_libraries(leandoc_fuzz_open PRIVATE leandoc_core)
endif()
