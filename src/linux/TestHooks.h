#pragma once

// Test hooks from SPEC section 5, kept free of GTK so
// tests/hosts/HostLogicTests.cpp can check the parsing directly.
//
//   --trace-timing          print "LEANDOC_TIMING <event> <ms> [key=value ...]"
//                           lines to stdout, flushed per line
//   --exit-after-render=MS  quit cleanly MS milliseconds after the first
//                           "rendered" message
//
// Both are inert unless their flag is given.

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace leandoc::linux_host {

constexpr std::string_view kTraceTimingFlag = "--trace-timing";
constexpr std::string_view kExitAfterRenderFlag = "--exit-after-render=";

// Accepts 0 to 600000 milliseconds written as plain decimal digits.
inline std::optional<unsigned> ParseExitAfterRender(std::string_view argument) {
    if (argument.substr(0, kExitAfterRenderFlag.size()) != kExitAfterRenderFlag) {
        return std::nullopt;
    }
    const std::string_view digits = argument.substr(kExitAfterRenderFlag.size());
    if (digits.empty() || digits.size() > 6) {
        return std::nullopt;
    }
    unsigned value = 0;
    for (const char digit : digits) {
        if (digit < '0' || digit > '9') {
            return std::nullopt;
        }
        value = value * 10 + static_cast<unsigned>(digit - '0');
    }
    if (value > 600000) {
        return std::nullopt;
    }
    return value;
}

// One trace line without the trailing newline, for example
// "LEANDOC_TIMING rendered 812 pages=3 readerMs=140".
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
    return line;
}

}  // namespace leandoc::linux_host
