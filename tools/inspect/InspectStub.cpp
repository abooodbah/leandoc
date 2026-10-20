// TEMPORARY stub of leandoc-inspect for host development.
#include "core/DocCore.h"

#include <filesystem>
#include <iostream>
#include <string>

namespace {

void Print(const std::filesystem::path& path) {
    const auto result = leandoc::core::OpenDocumentFile(path);
    const std::string report = leandoc::core::ReportToJson(result);
    const auto utf8 = path.u8string();
    std::cout << "{\"path\":\""
              << leandoc::core::EscapeJsonString(
                     std::string(utf8.begin(), utf8.end()))
              << "\"," << report.substr(1) << '\n';
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 3 && std::string(argv[1]) == "--folder") {
        std::error_code error;
        for (const auto& entry :
             std::filesystem::recursive_directory_iterator(argv[2], error)) {
            if (entry.is_regular_file() &&
                leandoc::core::IsSupportedDocumentPath(entry.path())) {
                Print(entry.path());
            }
        }
        return error ? 1 : 0;
    }
    for (int index = 1; index < argc; ++index) {
        Print(argv[index]);
    }
    return 0;
}
