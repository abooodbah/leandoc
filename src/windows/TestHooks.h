#pragma once

// Test hooks from SPEC section 5, free of Windows headers so
// tests/hosts/HostLogicTests.cpp checks the parsing on every platform.
//
//   --trace-timing          write "LEANDOC_TIMING <event> <ms> [key=value ...]"
//                           lines to standard output, one write per line
//   --exit-after-render=MS  close the window MS milliseconds after the first
//                           "rendered" message
//
// Both are inert unless their flag is given.

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace leandoc::windows_host {

constexpr std::wstring_view kTraceTimingFlag = L"--trace-timing";
constexpr std::wstring_view kExitAfterRenderFlag = L"--exit-after-render=";

// Accepts 0 to 600000 milliseconds written as plain decimal digits.
inline std::optional<unsigned> ParseExitAfterRender(std::wstring_view argument) {
    if (argument.substr(0, kExitAfterRenderFlag.size()) != kExitAfterRenderFlag) {
        return std::nullopt;
    }
    const std::wstring_view digits = argument.substr(kExitAfterRenderFlag.size());
    if (digits.empty() || digits.size() > 6) {
        return std::nullopt;
    }
    unsigned value = 0;
    for (const wchar_t digit : digits) {
        if (digit < L'0' || digit > L'9') {
            return std::nullopt;
        }
        value = value * 10 + static_cast<unsigned>(digit - L'0');
    }
    if (value > 600000) {
        return std::nullopt;
    }
    return value;
}

// One trace line including its newline, for example
// "LEANDOC_TIMING rendered 812 pages=3 readerMs=140\n".
inline std::string FormatTimingLine(
    std::string_view event, std::uint64_t milliseconds, std::string_view details = {}) {
    std::string line = "LEANDOC_TIMING ";
    line += event;
    line += ' ';
    line += std::to_string(milliseconds);
    if (!details.empty()) {
        line += ' ';
        line += details;
    }
    line += '\n';
    return line;
}

}  // namespace leandoc::windows_host
