# LeanDoc native hosts, packaging, and host tests. The root CMakeLists.txt
# includes this file after the portable core, so leandoc_core already exists.

# The corpus workflow builds only leandoc-inspect, without GTK, WebKit, or
# Node.js, by turning the hosts off.
option(LEANDOC_BUILD_HOSTS "Build the native hosts and their packages" ON)
if(NOT LEANDOC_BUILD_HOSTS)
  return()
endif()

set(LEANDOC_ROOT "${CMAKE_CURRENT_LIST_DIR}/..")
cmake_path(NORMAL_PATH LEANDOC_ROOT)
string(REGEX REPLACE "/$" "" LEANDOC_ROOT "${LEANDOC_ROOT}")
set(LEANDOC_GENERATED_DIR "${CMAKE_BINARY_DIR}/generated")

configure_file(
  "${LEANDOC_ROOT}/cmake/leandoc-version.h.in"
  "${LEANDOC_GENERATED_DIR}/leandoc-version.h"
  @ONLY)

# Shipped notices. The release uses the root THIRD_PARTY_NOTICES.md; until it
# exists the per-stream notice sections in docs/notices/ are joined instead.
set(LEANDOC_NOTICES_FILE "${LEANDOC_GENERATED_DIR}/THIRD_PARTY_NOTICES.md")
if(EXISTS "${LEANDOC_ROOT}/THIRD_PARTY_NOTICES.md")
  configure_file("${LEANDOC_ROOT}/THIRD_PARTY_NOTICES.md" "${LEANDOC_NOTICES_FILE}" COPYONLY)
else()
  file(GLOB LEANDOC_NOTICE_PARTS CONFIGURE_DEPENDS "${LEANDOC_ROOT}/docs/notices/*.md")
  list(SORT LEANDOC_NOTICE_PARTS)
  file(WRITE "${LEANDOC_NOTICES_FILE}" "# Third-party notices\n\n")
  foreach(part IN LISTS LEANDOC_NOTICE_PARTS)
    file(READ "${part}" LEANDOC_NOTICE_TEXT)
    file(APPEND "${LEANDOC_NOTICES_FILE}" "${LEANDOC_NOTICE_TEXT}\n")
  endforeach()
endif()

find_program(LEANDOC_NODE_EXECUTABLE NAMES node nodejs)
if(NOT LEANDOC_NODE_EXECUTABLE)
  message(FATAL_ERROR "Node.js 20 or newer is required to stage the reader assets.")
endif()

# The reader assets are staged by the reader's own script into the build
# tree. Hosts read them from there in tests and from their install location in
# packages.
set(LEANDOC_RUNTIME_ASSETS "${CMAKE_BINARY_DIR}/runtime/assets")
set(LEANDOC_RUNTIME_STAMP "${CMAKE_BINARY_DIR}/runtime/assets.stamp")
file(GLOB_RECURSE LEANDOC_ASSET_INPUTS CONFIGURE_DEPENDS "${LEANDOC_ROOT}/assets/*")
list(APPEND LEANDOC_ASSET_INPUTS
  "${LEANDOC_ROOT}/package.json"
  "${LEANDOC_ROOT}/package-lock.json"
  "${LEANDOC_ROOT}/scripts/stage-runtime-assets.mjs")
add_custom_command(
  OUTPUT "${LEANDOC_RUNTIME_STAMP}"
  COMMAND "${CMAKE_COMMAND}" -E remove_directory "${LEANDOC_RUNTIME_ASSETS}"
  COMMAND "${LEANDOC_NODE_EXECUTABLE}"
          "${LEANDOC_ROOT}/scripts/stage-runtime-assets.mjs"
          "${LEANDOC_RUNTIME_ASSETS}"
  COMMAND "${CMAKE_COMMAND}" -E touch "${LEANDOC_RUNTIME_STAMP}"
  DEPENDS ${LEANDOC_ASSET_INPUTS}
  WORKING_DIRECTORY "${LEANDOC_ROOT}"
  COMMENT "Staging LeanDoc's offline reader assets"
  VERBATIM)
add_custom_target(leandoc_runtime_assets ALL DEPENDS "${LEANDOC_RUNTIME_STAMP}")

set(LEANDOC_SMOKE_FIXTURE "${LEANDOC_ROOT}/tests/hosts/fixtures/smoke.docx")
set(LEANDOC_FALLBACK_FIXTURE "${LEANDOC_ROOT}/tests/hosts/fixtures/plain.rtf")

if(BUILD_TESTING)
  # Editor order, argument quoting, and message parsing are plain C++, so
  # every platform checks every host's copy.
  add_executable(leandoc_host_logic_tests "${LEANDOC_ROOT}/tests/hosts/HostLogicTests.cpp")
  target_compile_features(leandoc_host_logic_tests PRIVATE cxx_std_17)
  target_include_directories(leandoc_host_logic_tests PRIVATE "${LEANDOC_ROOT}/src")
  if(MSVC)
    target_compile_options(leandoc_host_logic_tests PRIVATE /W4 /permissive- /utf-8)
  else()
    target_compile_options(leandoc_host_logic_tests PRIVATE -Wall -Wextra -Wpedantic)
  endif()
  add_test(NAME leandoc-host-logic COMMAND leandoc_host_logic_tests)

  add_test(
    NAME leandoc-release-engineering
    COMMAND "${LEANDOC_NODE_EXECUTABLE}" "${LEANDOC_ROOT}/scripts/Test-ReleaseEngineering.mjs"
    WORKING_DIRECTORY "${LEANDOC_ROOT}")

  option(LEANDOC_ENABLE_GUI_TESTS
    "Run the real web-runtime smoke tests (Xvfb on Linux)" OFF)
endif()

# Windows: Win32 + WebView2 ----------------------------------------------------
if(WIN32)
  set(LEANDOC_WEBVIEW2_VERSION "1.0.4078.44")
  set(LEANDOC_WEBVIEW2_SDK
    "${LEANDOC_ROOT}/obj/webview2/${LEANDOC_WEBVIEW2_VERSION}"
    CACHE PATH "Extracted Microsoft.Web.WebView2 NuGet package")
  if(NOT EXISTS "${LEANDOC_WEBVIEW2_SDK}/build/native/include/WebView2.h")
    message(FATAL_ERROR
      "The WebView2 SDK ${LEANDOC_WEBVIEW2_VERSION} is missing at ${LEANDOC_WEBVIEW2_SDK}. "
      "Run scripts/Get-WebView2Sdk.ps1 or scripts/build.ps1 first.")
  endif()
  set(LEANDOC_WEBVIEW2_NATIVE "${LEANDOC_WEBVIEW2_SDK}/build/native/x64")

  configure_file(
    "${LEANDOC_ROOT}/src/windows/LeanDoc.manifest.in"
    "${LEANDOC_GENERATED_DIR}/LeanDoc.manifest"
    @ONLY)

  add_executable(LeanDoc WIN32
    "${LEANDOC_ROOT}/src/windows/main.cpp"
    "${LEANDOC_ROOT}/src/windows/App.cpp"
    "${LEANDOC_ROOT}/src/windows/Editor.cpp"
    "${LEANDOC_ROOT}/src/windows/Platform.cpp"
    "${LEANDOC_ROOT}/src/windows/LeanDoc.rc"
    "${LEANDOC_GENERATED_DIR}/LeanDoc.manifest")
  add_dependencies(LeanDoc leandoc_runtime_assets)
  target_compile_features(LeanDoc PRIVATE cxx_std_17)
  target_include_directories(LeanDoc PRIVATE
    "${LEANDOC_ROOT}/src"
    "${LEANDOC_ROOT}/src/windows"
    "${LEANDOC_GENERATED_DIR}"
    "${LEANDOC_WEBVIEW2_SDK}/build/native/include")
  target_compile_definitions(LeanDoc PRIVATE
    UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
  if(MSVC)
    target_compile_options(LeanDoc PRIVATE
      $<$<COMPILE_LANGUAGE:CXX>:/W4 /permissive- /utf-8 /sdl>)
  endif()
  target_link_libraries(LeanDoc PRIVATE
    leandoc_core
    "${LEANDOC_WEBVIEW2_NATIVE}/WebView2Loader.dll.lib"
    user32 gdi32 shell32 ole32 shlwapi dwmapi advapi32)
  # The loader DLL ships beside LeanDoc.exe, as in LeanMark, and the staged
  # reader assets sit in assets/ so the build tree runs as it is.
  add_custom_command(TARGET LeanDoc POST_BUILD
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
            "${LEANDOC_WEBVIEW2_NATIVE}/WebView2Loader.dll"
            "$<TARGET_FILE_DIR:LeanDoc>/WebView2Loader.dll"
    COMMAND "${CMAKE_COMMAND}" -E copy_directory
            "${LEANDOC_RUNTIME_ASSETS}" "$<TARGET_FILE_DIR:LeanDoc>/assets"
    VERBATIM)

  if(BUILD_TESTING AND LEANDOC_ENABLE_GUI_TESTS)
    add_test(NAME leandoc-windows-host
      COMMAND LeanDoc --smoke-test "${LEANDOC_SMOKE_FIXTURE}")
    add_test(NAME leandoc-windows-fallback
      COMMAND LeanDoc --smoke-test "${LEANDOC_FALLBACK_FIXTURE}")
    set_tests_properties(leandoc-windows-host leandoc-windows-fallback PROPERTIES
      TIMEOUT 30
      ENVIRONMENT "LEANDOC_ASSETS_DIR=${LEANDOC_RUNTIME_ASSETS}")
    # A file that cannot render must make the smoke test fail, not pass.
    set_tests_properties(leandoc-windows-fallback PROPERTIES WILL_FAIL TRUE)
  endif()
endif()

# macOS: AppKit + WKWebView ----------------------------------------------------
if(APPLE)
  add_subdirectory("${LEANDOC_ROOT}/macos" "${CMAKE_BINARY_DIR}/macos")
endif()

# Linux: GTK 4 + WebKitGTK 6.0 -------------------------------------------------
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(GTK4 REQUIRED IMPORTED_TARGET "gtk4>=4.10")
  pkg_check_modules(WEBKITGTK REQUIRED IMPORTED_TARGET "webkitgtk-6.0>=2.44")
  pkg_check_modules(GIOUNIX REQUIRED IMPORTED_TARGET "gio-unix-2.0")

  add_executable(leandoc
    "${LEANDOC_ROOT}/src/linux/main.cpp"
    "${LEANDOC_ROOT}/src/linux/LinuxApp.cpp"
    "${LEANDOC_ROOT}/src/linux/Timing.cpp")
  add_dependencies(leandoc leandoc_runtime_assets)
  target_compile_features(leandoc PRIVATE cxx_std_17)
  target_compile_options(leandoc PRIVATE -Wall -Wextra -Wpedantic -Werror)
  target_include_directories(leandoc PRIVATE "${LEANDOC_ROOT}/src")
  target_compile_definitions(leandoc PRIVATE
    "LEANDOC_INSTALL_ASSETS_DIR=\"${CMAKE_INSTALL_FULL_DATADIR}/leandoc/assets\""
    "LEANDOC_VERSION=\"${PROJECT_VERSION}\"")
  target_link_libraries(leandoc PRIVATE
    leandoc_core PkgConfig::GTK4 PkgConfig::WEBKITGTK PkgConfig::GIOUNIX)

  configure_file(
    "${LEANDOC_ROOT}/packaging/linux/io.github.abooodbah.leandoc.metainfo.xml.in"
    "${CMAKE_BINARY_DIR}/io.github.abooodbah.leandoc.metainfo.xml"
    @ONLY)

  install(TARGETS leandoc RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")
  install(DIRECTORY "${LEANDOC_RUNTIME_ASSETS}/"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/leandoc/assets")
  install(FILES "${LEANDOC_ROOT}/packaging/linux/io.github.abooodbah.leandoc.desktop"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/applications")
  install(FILES "${CMAKE_BINARY_DIR}/io.github.abooodbah.leandoc.metainfo.xml"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/metainfo")
  install(FILES "${LEANDOC_ROOT}/brand/leandoc-icon-256.png"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/icons/hicolor/256x256/apps"
    RENAME io.github.abooodbah.leandoc.png)
  install(FILES "${LEANDOC_ROOT}/brand/leandoc-icon-512.png"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/icons/hicolor/512x512/apps"
    RENAME io.github.abooodbah.leandoc.png)
  install(FILES "${LEANDOC_ROOT}/brand/leandoc-mark.svg"
    DESTINATION "${CMAKE_INSTALL_DATADIR}/icons/hicolor/scalable/apps"
    RENAME io.github.abooodbah.leandoc.svg)
  install(FILES "${LEANDOC_ROOT}/README.md" "${LEANDOC_ROOT}/LICENSE" "${LEANDOC_NOTICES_FILE}"
    DESTINATION "${CMAKE_INSTALL_DOCDIR}")

  if(BUILD_TESTING)
    add_test(
      NAME leandoc-linux-source-policy
      COMMAND "${LEANDOC_NODE_EXECUTABLE}" "${LEANDOC_ROOT}/tests/hosts/Test-LinuxSource.mjs")

    if(LEANDOC_ENABLE_GUI_TESTS)
      find_program(LEANDOC_XVFB_RUN_EXECUTABLE NAMES xvfb-run REQUIRED)
      add_test(
        NAME leandoc-linux-host
        COMMAND "${LEANDOC_XVFB_RUN_EXECUTABLE}" -a
                "$<TARGET_FILE:leandoc>" --smoke-test "${LEANDOC_SMOKE_FIXTURE}")
      # A file that cannot render must make the smoke test fail, not pass.
      add_test(
        NAME leandoc-linux-fallback
        COMMAND "${LEANDOC_XVFB_RUN_EXECUTABLE}" -a
                "$<TARGET_FILE:leandoc>" --smoke-test "${LEANDOC_FALLBACK_FIXTURE}")
      # A later launch must hand its file to the running window and exit.
      add_test(
        NAME leandoc-linux-single-instance
        COMMAND "${LEANDOC_XVFB_RUN_EXECUTABLE}" -a bash
                "${LEANDOC_ROOT}/tests/hosts/Test-LinuxSingleInstance.sh"
                "$<TARGET_FILE:leandoc>" "${LEANDOC_SMOKE_FIXTURE}"
                "${LEANDOC_ROOT}/tests/hosts/fixtures/second.docx")
      # --trace-timing and --exit-after-render, the SPEC section 5 hooks.
      add_test(
        NAME leandoc-linux-test-hooks
        COMMAND "${LEANDOC_XVFB_RUN_EXECUTABLE}" -a bash
                "${LEANDOC_ROOT}/tests/hosts/Test-TimingHooks.sh"
                "$<TARGET_FILE:leandoc>" "${LEANDOC_SMOKE_FIXTURE}")
      set_tests_properties(
        leandoc-linux-host leandoc-linux-fallback leandoc-linux-single-instance
        leandoc-linux-test-hooks
        PROPERTIES
          ENVIRONMENT
            "LEANDOC_ASSETS_DIR=${LEANDOC_RUNTIME_ASSETS};WEBKIT_DISABLE_COMPOSITING_MODE=1;XDG_CONFIG_HOME=${CMAKE_BINARY_DIR}/test-config;GTK_A11Y=none"
          TIMEOUT 60)
      set_tests_properties(leandoc-linux-fallback PROPERTIES WILL_FAIL TRUE)
    endif()
  endif()

  if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|amd64|AMD64)$")
    set(LEANDOC_RELEASE_ARCHITECTURE "x86_64")
    set(CPACK_DEBIAN_PACKAGE_ARCHITECTURE "amd64")
  else()
    set(LEANDOC_RELEASE_ARCHITECTURE "${CMAKE_SYSTEM_PROCESSOR}")
  endif()

  set(CPACK_GENERATOR "DEB")
  set(CPACK_PACKAGE_NAME "LeanDoc")
  set(CPACK_PACKAGE_VENDOR "Abdulfatah Bahbouh")
  set(CPACK_PACKAGE_CONTACT "https://github.com/abooodbah/leandoc/issues")
  set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "${PROJECT_DESCRIPTION}")
  set(CPACK_PACKAGE_HOMEPAGE_URL "${PROJECT_HOMEPAGE_URL}")
  set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
  set(CPACK_PACKAGE_FILE_NAME
    "LeanDoc-v${PROJECT_VERSION}-linux-${LEANDOC_RELEASE_ARCHITECTURE}")
  set(CPACK_RESOURCE_FILE_LICENSE "${LEANDOC_ROOT}/LICENSE")
  set(CPACK_STRIP_FILES TRUE)
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "Abdulfatah Bahbouh")
  set(CPACK_DEBIAN_PACKAGE_NAME "leandoc")
  set(CPACK_DEBIAN_PACKAGE_SECTION "text")
  set(CPACK_DEBIAN_PACKAGE_PRIORITY "optional")
  set(CPACK_DEBIAN_PACKAGE_HOMEPAGE "https://abooodbah.github.io/leandoc/")
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)
  set(CPACK_DEBIAN_FILE_NAME "${CPACK_PACKAGE_FILE_NAME}.deb")
  set(CPACK_INCLUDE_TOPLEVEL_DIRECTORY TRUE)
  include(CPack)
endif()
