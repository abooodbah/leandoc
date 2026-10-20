# TEMPORARY stub for host development. Stream A replaces this file.
add_library(leandoc_core STATIC DocCoreStub.cpp)
target_compile_features(leandoc_core PUBLIC cxx_std_17)
target_include_directories(leandoc_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/..")
