# LeanDoc for macOS: AppKit + WKWebView, a universal application bundle.
# Added by cmake/Hosts.cmake, so leandoc_core and the staged reader assets
# (leandoc_runtime_assets, LEANDOC_RUNTIME_ASSETS) already exist.

if(NOT APPLE)
  message(FATAL_ERROR "The LeanDoc macOS target requires an Apple toolchain.")
endif()
enable_language(OBJCXX)

if(NOT CMAKE_OSX_ARCHITECTURES)
  message(STATUS "CMAKE_OSX_ARCHITECTURES is not set; package_macos needs arm64;x86_64.")
endif()

set(LEANDOC_BUNDLE_IDENTIFIER "io.github.abooodbah.LeanDoc" CACHE STRING
    "Reverse-DNS bundle identifier")
set(LEANDOC_BUILD_NUMBER "1" CACHE STRING "Monotonic CFBundleVersion value")

configure_file(
  "${CMAKE_CURRENT_LIST_DIR}/Info.plist.in"
  "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
  @ONLY)

add_executable(LeanDoc MACOSX_BUNDLE
  src/main.mm
  src/LDAppDelegate.mm
  src/LDDocument.mm
  src/LDDocumentController.mm
  src/LDDocumentWindowController.mm
  src/LDEditor.mm
  src/LDSchemeHandler.mm
  src/LDTiming.mm)
add_dependencies(LeanDoc leandoc_runtime_assets)

target_include_directories(LeanDoc PRIVATE
  "${LEANDOC_ROOT}/src"
  "${LEANDOC_GENERATED_DIR}"
  "${CMAKE_CURRENT_LIST_DIR}/src")
target_compile_features(LeanDoc PRIVATE cxx_std_17)
target_compile_options(LeanDoc PRIVATE
  -Wall -Wextra
  $<$<COMPILE_LANGUAGE:CXX,OBJCXX>:-Wpedantic>
  $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
target_link_libraries(LeanDoc PRIVATE
  leandoc_core
  "-framework AppKit"
  "-framework WebKit"
  "-framework UniformTypeIdentifiers")

set_target_properties(LeanDoc PROPERTIES
  OUTPUT_NAME "LeanDoc"
  MACOSX_BUNDLE TRUE
  MACOSX_BUNDLE_GUI_IDENTIFIER "${LEANDOC_BUNDLE_IDENTIFIER}"
  MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
  XCODE_ATTRIBUTE_CLANG_ENABLE_OBJC_ARC "YES"
  XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED "NO"
  XCODE_ATTRIBUTE_CODE_SIGNING_REQUIRED "NO"
  XCODE_ATTRIBUTE_ENABLE_HARDENED_RUNTIME "YES"
  XCODE_ATTRIBUTE_MACOSX_DEPLOYMENT_TARGET "${CMAKE_OSX_DEPLOYMENT_TARGET}"
  XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH "NO")
set_property(TARGET LeanDoc PROPERTY
  XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "${LEANDOC_BUNDLE_IDENTIFIER}")

# The reader assets go to Resources/assets; the icon and the notices sit
# beside them.
add_custom_command(TARGET LeanDoc POST_BUILD
  COMMAND "${CMAKE_COMMAND}" -E remove_directory "$<TARGET_FILE_DIR:LeanDoc>/../Resources/assets"
  COMMAND "${CMAKE_COMMAND}" -E make_directory "$<TARGET_FILE_DIR:LeanDoc>/../Resources"
  COMMAND "${CMAKE_COMMAND}" -E copy_directory
          "${LEANDOC_RUNTIME_ASSETS}" "$<TARGET_FILE_DIR:LeanDoc>/../Resources/assets"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
          "${CMAKE_CURRENT_LIST_DIR}/LeanDoc.icns"
          "$<TARGET_FILE_DIR:LeanDoc>/../Resources/LeanDoc.icns"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
          "${LEANDOC_ROOT}/LICENSE" "$<TARGET_FILE_DIR:LeanDoc>/../Resources/LICENSE.txt"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
          "${LEANDOC_NOTICES_FILE}"
          "$<TARGET_FILE_DIR:LeanDoc>/../Resources/THIRD_PARTY_NOTICES.md"
  COMMENT "Embedding the reader assets, icon, and licence notices"
  VERBATIM)

install(TARGETS LeanDoc BUNDLE DESTINATION .)

if(BUILD_TESTING)
  find_package(Python3 3.9 COMPONENTS Interpreter REQUIRED)
  add_test(
    NAME leandoc-macos-static
    COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_LIST_DIR}/tests/test_static.py"
            "${LEANDOC_ROOT}")
  add_test(
    NAME leandoc-macos-host
    COMMAND "$<TARGET_FILE:LeanDoc>" --smoke-test "${LEANDOC_SMOKE_FIXTURE}")
  # A file that cannot render must make the smoke test fail, not pass.
  add_test(
    NAME leandoc-macos-fallback
    COMMAND "$<TARGET_FILE:LeanDoc>" --smoke-test "${LEANDOC_FALLBACK_FIXTURE}")
  # --trace-timing and --exit-after-render, the SPEC section 5 hooks.
  add_test(
    NAME leandoc-macos-test-hooks
    COMMAND bash "${LEANDOC_ROOT}/tests/hosts/Test-TimingHooks.sh"
            "$<TARGET_FILE:LeanDoc>" "${LEANDOC_SMOKE_FIXTURE}")
  set_tests_properties(leandoc-macos-host leandoc-macos-fallback leandoc-macos-test-hooks
    PROPERTIES TIMEOUT 40)
  set_tests_properties(leandoc-macos-fallback PROPERTIES WILL_FAIL TRUE)
endif()

add_custom_target(package_macos
  COMMAND bash "${CMAKE_CURRENT_LIST_DIR}/scripts/package-macos.sh"
          --app "$<TARGET_BUNDLE_DIR:LeanDoc>"
          --version "${PROJECT_VERSION}"
          --output "${LEANDOC_ROOT}/release"
          --sign ad-hoc
  DEPENDS LeanDoc
  COMMENT "Creating an ad-hoc-signed universal preview package"
  VERBATIM)
