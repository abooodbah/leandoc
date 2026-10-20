#pragma once

// The "Open in ..." resolution order from SPEC section 5 and the command-line
// quoting used to launch the editor. Both are free of Windows headers so
// tests/hosts/HostLogicTests.cpp checks them on every operating system.

#include <string>
#include <string_view>
#include <vector>

namespace leandoc::windows_host {

enum class EditorKind { Word, LibreOffice, Default, Web };

constexpr wchar_t kWordForTheWebUrl[] = L"https://www.office.com/launch/word";

struct EditorCandidates {
    std::wstring word;         // full path of WINWORD.EXE, empty when absent
    std::wstring libreOffice;  // full path of soffice.exe, empty when absent
    std::wstring defaultApp;   // executable that opens .docx, empty when none
    std::wstring defaultAppName;  // its friendly name, may be empty
    bool defaultIsSelf = false;   // true when that executable is LeanDoc
};

struct EditorChoice {
    EditorKind kind = EditorKind::Web;
    std::string label;    // UTF-8, shown on the reader's button
    std::wstring target;  // executable path, or the Word for the web URL
};

inline const char* EditorKindName(EditorKind kind) {
    switch (kind) {
        case EditorKind::Word:
            return "word";
        case EditorKind::LibreOffice:
            return "libreoffice";
        case EditorKind::Default:
            return "default";
        default:
            return "web";
    }
}

// Word, then LibreOffice, then the default handler when it is not LeanDoc,
// then Word for the web. `utf8Name` converts the friendly name for the label.
template <typename ToUtf8>
EditorChoice ChooseEditor(const EditorCandidates& candidates, ToUtf8 utf8Name) {
    EditorChoice choice;
    if (!candidates.word.empty()) {
        choice.kind = EditorKind::Word;
        choice.label = "Open in Word";
        choice.target = candidates.word;
    } else if (!candidates.libreOffice.empty()) {
        choice.kind = EditorKind::LibreOffice;
        choice.label = "Open in LibreOffice";
        choice.target = candidates.libreOffice;
    } else if (!candidates.defaultApp.empty() && !candidates.defaultIsSelf) {
        choice.kind = EditorKind::Default;
        const std::string name = utf8Name(candidates.defaultAppName);
        choice.label = name.empty() ? std::string("Open with default app") : "Open in " + name;
        choice.target = candidates.defaultApp;
    } else {
        choice.kind = EditorKind::Web;
        choice.label = "Open Word for the web";
        choice.target = kWordForTheWebUrl;
    }
    return choice;
}

// Quotes one argument so CommandLineToArgvW and the C runtime read it back
// unchanged: backslashes are doubled only before a quote or the closing quote.
inline std::wstring QuoteArgument(std::wstring_view argument) {
    if (!argument.empty() && argument.find_first_of(L" \t\n\v\"") == std::wstring_view::npos) {
        return std::wstring(argument);
    }
    std::wstring quoted = L"\"";
    for (std::size_t index = 0;; ++index) {
        std::size_t backslashes = 0;
        while (index < argument.size() && argument[index] == L'\\') {
            ++index;
            ++backslashes;
        }
        if (index == argument.size()) {
            quoted.append(backslashes * 2, L'\\');
            break;
        }
        if (argument[index] == L'"') {
            quoted.append(backslashes * 2 + 1, L'\\');
            quoted.push_back(L'"');
        } else {
            quoted.append(backslashes, L'\\');
            quoted.push_back(argument[index]);
        }
    }
    quoted.push_back(L'"');
    return quoted;
}

inline std::wstring BuildCommandLine(const std::vector<std::wstring>& arguments) {
    std::wstring commandLine;
    for (const std::wstring& argument : arguments) {
        if (!commandLine.empty()) {
            commandLine.push_back(L' ');
        }
        commandLine += QuoteArgument(argument);
    }
    return commandLine;
}

}  // namespace leandoc::windows_host
