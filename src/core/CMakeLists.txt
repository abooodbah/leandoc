# LeanDoc's portable core: leandoc_core, with miniz and pugixml compiled in.

set(LEANDOC_THIRD_PARTY "${PROJECT_SOURCE_DIR}/third_party")

option(LEANDOC_WARNINGS_AS_ERRORS
  "Treat warnings in LeanDoc's own core sources as errors" ON)

# Shared configuration for every target that includes miniz or pugixml, so
# the headers always see the same macros as the compiled sources.
add_library(leandoc_vendor_config INTERFACE)
target_include_directories(leandoc_vendor_config SYSTEM INTERFACE
  "${LEANDOC_THIRD_PARTY}/miniz"
  "${LEANDOC_THIRD_PARTY}/pugixml")
target_compile_definitions(leandoc_vendor_config INTERFACE
  MINIZ_NO_STDIO
  MINIZ_NO_TIME
  MINIZ_NO_ARCHIVE_WRITING_APIS
  MINIZ_NO_ZLIB_COMPATIBLE_NAMES
  PUGIXML_NO_EXCEPTIONS
  PUGIXML_NO_XPATH)

set(LEANDOC_CORE_SOURCES
  Cfb.cpp
  DocCore.cpp
  Links.cpp
  Word.cpp
  Xml.cpp
  Zip.cpp)
set(LEANDOC_VENDOR_SOURCES
  "${LEANDOC_THIRD_PARTY}/miniz/miniz.c"
  "${LEANDOC_THIRD_PARTY}/pugixml/pugixml.cpp")

add_library(leandoc_core STATIC ${LEANDOC_CORE_SOURCES} ${LEANDOC_VENDOR_SOURCES})
target_compile_features(leandoc_core PUBLIC cxx_std_17)
target_include_directories(leandoc_core PUBLIC "${PROJECT_SOURCE_DIR}/src")
target_link_libraries(leandoc_core PRIVATE leandoc_vendor_config)

# Warnings apply to LeanDoc's sources only; upstream code is compiled as is.
if(MSVC)
  set(LEANDOC_CORE_WARNINGS /W4 /permissive-)
  set(LEANDOC_VENDOR_WARNINGS /w)
  set(LEANDOC_WERROR /WX)
else()
  set(LEANDOC_CORE_WARNINGS -Wall -Wextra -Wpedantic)
  set(LEANDOC_VENDOR_WARNINGS -w)
  set(LEANDOC_WERROR -Werror)
endif()
if(LEANDOC_WARNINGS_AS_ERRORS)
  list(APPEND LEANDOC_CORE_WARNINGS ${LEANDOC_WERROR})
endif()
set_source_files_properties(${LEANDOC_CORE_SOURCES}
  PROPERTIES COMPILE_OPTIONS "${LEANDOC_CORE_WARNINGS}")
set_source_files_properties(${LEANDOC_VENDOR_SOURCES}
  PROPERTIES COMPILE_OPTIONS "${LEANDOC_VENDOR_WARNINGS}")

# Used by the inspect tool and the tests in sibling directories.
set(LEANDOC_CORE_WARNINGS "${LEANDOC_CORE_WARNINGS}" PARENT_SCOPE)
