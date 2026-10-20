// leandoc-inspect: prints the core's JSON report for each document, one line
// per file. It reads documents and never writes into the folders it scans;
// the only file it ever writes is the one named by --write-sanitized.

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <vector>

#include "core/DocCore.h"

namespace {

namespace core = leandoc::core;
namespace fs = std::filesystem;

constexpr int kUsageError = 2;

void PrintUsage() {
    std::fputs(
        "Usage:\n"
        "  leandoc-inspect [--time] FILE...\n"
        "  leandoc-inspect [--time] --folder DIR\n"
        "  leandoc-inspect --write-sanitized OUT.docx FILE\n"
        "\n"
        "Prints one JSON report per file. --folder walks DIR recursively for\n"
        "supported extensions without following symbolic links. --time adds\n"
        "the open time in milliseconds as \"ms\".\n",
        stderr);
}

// Paths on POSIX are bytes; JSON needs valid UTF-8.
std::string ValidUtf8(const std::string& value) {
    std::string output;
    output.reserve(value.size());
    std::size_t index = 0;
    while (index < value.size()) {
        const auto first = static_cast<unsigned char>(value[index]);
        std::size_t length = first < 0x80                    ? 1
                             : (first >= 0xC2 && first <= 0xDF) ? 2
                             : (first >= 0xE0 && first <= 0xEF) ? 3
                             : (first >= 0xF0 && first <= 0xF4) ? 4
                                                                : 0;
        bool valid = length > 0 && index + length <= value.size();
        for (std::size_t offset = 1; valid && offset < length; ++offset) {
            valid = (static_cast<unsigned char>(value[index + offset]) & 0xC0) == 0x80;
        }
        if (valid && length == 3) {
            const auto second = static_cast<unsigned char>(value[index + 1]);
            valid = !(first == 0xE0 && second < 0xA0) && !(first == 0xED && second >= 0xA0);
        } else if (valid && length == 4) {
            const auto second = static_cast<unsigned char>(value[index + 1]);
            valid = !(first == 0xF0 && second < 0x90) && !(first == 0xF4 && second >= 0x90);
        }
        if (valid) {
            output.append(value, index, length);
            index += length;
        } else {
            output += "\xEF\xBF\xBD";
            ++index;
        }
    }
    return output;
}

std::string PathText(const fs::path& path) {
    return ValidUtf8(path.u8string());
}

void PrintResult(const fs::path& path, const core::OpenResult& result, double milliseconds) {
    std::string line = "{\"path\":\"";
    core::AppendJsonString(line, PathText(path));
    line += '"';
    if (milliseconds >= 0) {
        char text[32];
        std::snprintf(text, sizeof(text), "%.1f", milliseconds);
        line += ",\"ms\":";
        line += text;
    }
    const std::string report = core::ReportToJson(result);
    line += ',';
    line.append(report, 1, std::string::npos);
    line += '\n';
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fflush(stdout);
}

void PrintReport(const fs::path& path, bool timed) {
    const auto start = std::chrono::steady_clock::now();
    const core::OpenResult result = core::OpenDocumentFile(path);
    const auto elapsed = std::chrono::steady_clock::now() - start;
    PrintResult(
        path, result,
        timed ? std::chrono::duration<double, std::milli>(elapsed).count() : -1.0);
}

std::vector<fs::path> CollectFolder(const fs::path& root) {
    std::vector<fs::path> files;
    std::error_code error;
    fs::recursive_directory_iterator iterator(
        root, fs::directory_options::skip_permission_denied, error);
    const fs::recursive_directory_iterator end;
    while (!error && iterator != end) {
        const fs::directory_entry& entry = *iterator;
        std::error_code statusError;
        const fs::file_status status = entry.symlink_status(statusError);
        if (!statusError && fs::is_regular_file(status) &&
            core::IsSupportedDocumentPath(entry.path())) {
            files.push_back(entry.path());
        }
        // Directory symlinks are not followed by default; regular-file
        // symlinks are skipped above because their own status is a symlink.
        iterator.increment(error);
        if (error) {
            // Skip what cannot be read and keep walking.
            error.clear();
        }
    }
    std::sort(files.begin(), files.end());
    return files;
}

int WriteSanitized(const fs::path& output, const fs::path& input) {
    std::error_code error;
    if (fs::exists(output, error) && fs::equivalent(output, input, error)) {
        std::fputs("leandoc-inspect: the output must not be the input file.\n", stderr);
        return kUsageError;
    }
    const core::OpenResult result = core::OpenDocumentFile(input);
    PrintResult(input, result, -1.0);
    if (!result.ok || result.sanitizedPackage.empty()) {
        std::fputs("leandoc-inspect: no sanitized package for this file.\n", stderr);
        return 1;
    }
    std::ofstream stream(output, std::ios::binary | std::ios::trunc);
    stream.write(
        result.sanitizedPackage.data(),
        static_cast<std::streamsize>(result.sanitizedPackage.size()));
    if (!stream) {
        std::fputs("leandoc-inspect: could not write the sanitized package.\n", stderr);
        return 1;
    }
    return 0;
}

int Run(const std::vector<fs::path>& arguments) {
    bool timed = false;
    std::vector<fs::path> files;
    fs::path folder;
    fs::path sanitizedOutput;
    for (std::size_t index = 0; index < arguments.size(); ++index) {
        const std::string option = arguments[index].u8string();
        if (option == "--time") {
            timed = true;
        } else if (option == "--folder" || option == "--write-sanitized") {
            if (index + 1 >= arguments.size()) {
                PrintUsage();
                return kUsageError;
            }
            (option == "--folder" ? folder : sanitizedOutput) = arguments[++index];
        } else if (option == "--help" || option == "-h") {
            PrintUsage();
            return 0;
        } else if (option.size() > 1 && option[0] == '-' && option[1] == '-') {
            PrintUsage();
            return kUsageError;
        } else {
            files.push_back(arguments[index]);
        }
    }

    if (!sanitizedOutput.empty()) {
        if (!folder.empty() || files.size() != 1) {
            PrintUsage();
            return kUsageError;
        }
        return WriteSanitized(sanitizedOutput, files.front());
    }
    if (!folder.empty()) {
        if (!files.empty()) {
            PrintUsage();
            return kUsageError;
        }
        std::error_code error;
        if (!fs::is_directory(folder, error)) {
            std::fputs("leandoc-inspect: --folder needs a folder.\n", stderr);
            return kUsageError;
        }
        files = CollectFolder(folder);
    } else if (files.empty()) {
        PrintUsage();
        return kUsageError;
    }
    for (const fs::path& file : files) {
        PrintReport(file, timed);
    }
    return 0;
}

}  // namespace

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
    std::vector<fs::path> arguments;
    for (int index = 1; index < argc; ++index) {
        arguments.emplace_back(argv[index]);
    }
    return Run(arguments);
}
#else
int main(int argc, char** argv) {
    std::vector<fs::path> arguments;
    for (int index = 1; index < argc; ++index) {
        arguments.emplace_back(argv[index]);
    }
    return Run(arguments);
}
#endif
