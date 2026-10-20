add_executable(leandoc-inspect main.cpp)
target_compile_features(leandoc-inspect PRIVATE cxx_std_17)
target_compile_options(leandoc-inspect PRIVATE ${LEANDOC_CORE_WARNINGS})
target_link_libraries(leandoc-inspect PRIVATE leandoc_core)
