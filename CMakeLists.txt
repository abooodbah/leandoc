cmake_minimum_required(VERSION 3.22)

if(CMAKE_HOST_APPLE)
  if(NOT DEFINED CMAKE_OSX_DEPLOYMENT_TARGET OR
     CMAKE_OSX_DEPLOYMENT_TARGET STREQUAL "")
    set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING
        "Oldest supported macOS release" FORCE)
  endif()
endif()

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package.json" LEANDOC_PACKAGE_JSON)
string(JSON LEANDOC_MANIFEST_VERSION GET "${LEANDOC_PACKAGE_JSON}" version)

project(
  LeanDoc
  VERSION "${LEANDOC_MANIFEST_VERSION}"
  DESCRIPTION "A focused, read-only offline viewer for Word documents"
  HOMEPAGE_URL "https://abooodbah.github.io/leandoc/"
  LANGUAGES C CXX)

include(CTest)
include(GNUInstallDirs)

# Stream A: portable core, leandoc-inspect, and core tests.
add_subdirectory(src/core)
add_subdirectory(tools/inspect)
if(BUILD_TESTING)
  add_subdirectory(tests/core)
endif()

# Stream C: native hosts and packaging. Each file adds its own targets.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/cmake/Hosts.cmake")
  include(cmake/Hosts.cmake)
endif()
