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

// --test-script FILE: the host reads FILE one line at a time after the
// reader's first "ready" and runs each command before reading the next, so a
// harness can drive the real window (FILE may be a FIFO). Every command
// answers with one "LEANDOC_TEST <line> <command> <ok|error> <ms> [result]"
// line on stdout. Inert unless the flag is given; see
// docs/architecture/hosts.md for the commands.
constexpr std::string_view kTestScriptFlag = "--test-script";

enum class ScriptCommandKind {
    Empty,
    Js,
    Wait,
    WaitRender,
    Open,
    Drop,
    Sleep,
    Mark,
    Timeout,
    SystemTheme,
    Resize,
    Quit,
    Invalid
};

struct ScriptCommand {
    ScriptCommandKind kind = ScriptCommandKind::Empty;
    std::string name;
    std::string argument;
    unsigned number = 0;
    unsigned secondNumber = 0;
};

inline std::optional<unsigned> ParseScriptNumber(std::string_view digits) {
    if (digits.empty() || digits.size() > 7) {
        return std::nullopt;
    }
    unsigned value = 0;
    for (const char digit : digits) {
        if (digit < '0' || digit > '9') {
            return std::nullopt;
        }
        value = value * 10 + static_cast<unsigned>(digit - '0');
    }
    return value;
}

// Splits one script line into a command and its argument. Blank lines and
// lines starting with '#' are Empty. The argument is the rest of the line
// after one space, kept as written.
inline ScriptCommand ParseScriptCommand(std::string_view line) {
    while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) {
        line.remove_suffix(1);
    }
    std::size_t start = 0;
    while (start < line.size() && (line[start] == ' ' || line[start] == '\t')) {
        ++start;
    }
    line.remove_prefix(start);
    ScriptCommand command;
    if (line.empty() || line.front() == '#') {
        return command;
    }
    const std::size_t space = line.find(' ');
    command.name = std::string(line.substr(0, space));
    command.argument =
        space == std::string_view::npos ? std::string() : std::string(line.substr(space + 1));
    const std::string& name = command.name;
    const std::string& argument = command.argument;
    command.kind = ScriptCommandKind::Invalid;
    if (name == "js" || name == "wait") {
        if (!argument.empty()) {
            command.kind = name == "js" ? ScriptCommandKind::Js : ScriptCommandKind::Wait;
        }
    } else if (name == "wait-render") {
        if (argument.empty()) {
            command.kind = ScriptCommandKind::WaitRender;
        }
    } else if (name == "open" || name == "drop") {
        if (!argument.empty()) {
            command.kind = name == "open" ? ScriptCommandKind::Open : ScriptCommandKind::Drop;
        }
    } else if (name == "sleep" || name == "timeout") {
        if (const auto value = ParseScriptNumber(argument)) {
            command.number = *value;
            command.kind =
                name == "sleep" ? ScriptCommandKind::Sleep : ScriptCommandKind::Timeout;
        }
    } else if (name == "mark") {
        command.kind = ScriptCommandKind::Mark;
    } else if (name == "system-theme") {
        if (argument == "light" || argument == "dark") {
            command.kind = ScriptCommandKind::SystemTheme;
        }
    } else if (name == "resize") {
        const std::size_t separator = argument.find(' ');
        const auto width = separator == std::string::npos
                               ? std::nullopt
                               : ParseScriptNumber(std::string_view(argument).substr(0, separator));
        const auto height = separator == std::string::npos
                                ? std::nullopt
                                : ParseScriptNumber(std::string_view(argument).substr(separator + 1));
        if (width && height && *width >= 320 && *height >= 240) {
            command.number = *width;
            command.secondNumber = *height;
            command.kind = ScriptCommandKind::Resize;
        }
    } else if (name == "quit") {
        command.kind = ScriptCommandKind::Quit;
    }
    return command;
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
