# Runs leandoc-inspect the way the corpus run and the owner's scripts do.
# Variables: INSPECT (the executable), FIXTURES (tests/fixtures).

function(expect_contains haystack needle label)
  string(FIND "${haystack}" "${needle}" position)
  if(position EQUAL -1)
    message(FATAL_ERROR "${label}: expected to find ${needle} in:\n${haystack}")
  endif()
endfunction()

execute_process(
  COMMAND "${INSPECT}" --time "${FIXTURES}/features/styles.docx" "${FIXTURES}/security/legacy.doc"
  RESULT_VARIABLE result
  OUTPUT_VARIABLE output)
if(NOT result EQUAL 0)
  message(FATAL_ERROR "leandoc-inspect FILE... exited ${result}")
endif()
string(REGEX MATCHALL "\n" lines "${output}")
list(LENGTH lines count)
if(NOT count EQUAL 2)
  message(FATAL_ERROR "expected two report lines, got ${count}:\n${output}")
endif()
expect_contains("${output}" "{\"path\":\"" "path first")
expect_contains("${output}" "\"ms\":" "--time")
expect_contains("${output}" "\"kind\":\"docx\"" "docx kind")
expect_contains("${output}" "\"kind\":\"legacy-doc\"" "legacy kind")

# A rejected document is still processed: exit 0.
execute_process(
  COMMAND "${INSPECT}" "${FIXTURES}/security/zip-bomb.docx"
  RESULT_VARIABLE result
  OUTPUT_VARIABLE output)
if(NOT result EQUAL 0)
  message(FATAL_ERROR "a rejected document should still exit 0, got ${result}")
endif()
expect_contains("${output}" "\"errorCode\":\"part-too-large\"" "zip bomb")

execute_process(
  COMMAND "${INSPECT}" --folder "${FIXTURES}/security"
  RESULT_VARIABLE result
  OUTPUT_VARIABLE output)
if(NOT result EQUAL 0)
  message(FATAL_ERROR "--folder exited ${result}")
endif()
expect_contains("${output}" "legacy.doc" "--folder finds .doc")
expect_contains("${output}" "macro.docm" "--folder finds .docm")

execute_process(COMMAND "${INSPECT}" RESULT_VARIABLE result OUTPUT_QUIET ERROR_QUIET)
if(NOT result EQUAL 2)
  message(FATAL_ERROR "no arguments should be a usage error (2), got ${result}")
endif()
execute_process(COMMAND "${INSPECT}" --bogus x.docx RESULT_VARIABLE result OUTPUT_QUIET ERROR_QUIET)
if(NOT result EQUAL 2)
  message(FATAL_ERROR "an unknown option should be a usage error (2), got ${result}")
endif()
