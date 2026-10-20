# Converts sanitized packages to text with LibreOffice headless: each must
# open as a valid document and keep its text.
# Variables: INSPECT, SOFFICE, FIXTURES, WORK (a scratch folder in the build tree).

file(REMOVE_RECURSE "${WORK}")
file(MAKE_DIRECTORY "${WORK}/packages" "${WORK}/text")

# fixture | text the converted document must contain
set(cases
  "features/styles.docx|Derived style adds bold."
  "features/tables.docx|Spans two rows"
  "features/notes.docx|A sentence with a footnote."
  "features/tracked-changes.docx|The quick brown fox jumps."
  "features/images.docx|A blue picture follows."
  "features/headers-footers.docx|Body text on page 4."
  "features/arabic.docx|هذه فقرة عربية"
  "features/not-displayed.docx|The end."
  "features/drawn-content.docx|Inline:"
  "security/hyperlinks.docx|Script link"
  "security/include-field.docx|Cached picture text"
  "security/dde.docx|Cached DDE result"
  "security/macro.docm|A macro-enabled document."
  "security/remote-template.docx|remote template")

set(packages "")
foreach(case IN LISTS cases)
  string(REPLACE "|" ";" parts "${case}")
  list(GET parts 0 fixture)
  get_filename_component(stem "${fixture}" NAME_WE)
  set(package "${WORK}/packages/${stem}.docx")
  execute_process(
    COMMAND "${INSPECT}" --write-sanitized "${package}" "${FIXTURES}/${fixture}"
    RESULT_VARIABLE result
    OUTPUT_QUIET)
  if(NOT result EQUAL 0 OR NOT EXISTS "${package}")
    message(FATAL_ERROR "could not write the sanitized package for ${fixture}")
  endif()
  list(APPEND packages "${package}")
endforeach()

execute_process(
  COMMAND "${SOFFICE}" --headless --norestore --nologo
          "-env:UserInstallation=file://${WORK}/profile"
          --convert-to "txt:Text (encoded):UTF8" --outdir "${WORK}/text" ${packages}
  RESULT_VARIABLE result
  OUTPUT_VARIABLE output
  ERROR_VARIABLE errors
  TIMEOUT 240)
if(NOT result EQUAL 0)
  message(FATAL_ERROR "soffice exited ${result}:\n${output}\n${errors}")
endif()

foreach(case IN LISTS cases)
  string(REPLACE "|" ";" parts "${case}")
  list(GET parts 0 fixture)
  list(GET parts 1 needle)
  get_filename_component(stem "${fixture}" NAME_WE)
  set(text "${WORK}/text/${stem}.txt")
  if(NOT EXISTS "${text}")
    message(FATAL_ERROR "LibreOffice did not convert the sanitized ${fixture}:\n${output}\n${errors}")
  endif()
  file(READ "${text}" contents)
  string(FIND "${contents}" "${needle}" position)
  if(position EQUAL -1)
    message(FATAL_ERROR "the sanitized ${fixture} lost \"${needle}\":\n${contents}")
  endif()
endforeach()
list(LENGTH cases count)
message(STATUS "LibreOffice converted ${count} sanitized packages")
