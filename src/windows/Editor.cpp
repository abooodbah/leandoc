#include "Editor.h"

#include "Platform.h"

#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>

#include <filesystem>
#include <vector>

#pragma comment(lib, "shlwapi.lib")

namespace leandoc::windows_host {
namespace {

bool SameText(std::wstring_view left, std::wstring_view right) {
    return CompareStringOrdinal(
               left.data(), static_cast<int>(left.size()),
               right.data(), static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}

std::wstring Unquote(std::wstring value) {
    if (value.size() >= 2 && value.front() == L'"') {
        const std::size_t closing = value.find(L'"', 1);
        if (closing != std::wstring::npos) {
            return value.substr(1, closing - 1);
        }
    }
    return value;
}

bool IsExistingFile(const std::wstring& path) {
    if (path.empty()) {
        return false;
    }
    const DWORD attributes = GetFileAttributesW(path.c_str());
    return attributes != INVALID_FILE_ATTRIBUTES &&
           (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

std::wstring FileName(const std::wstring& path) {
    return std::filesystem::path(path).filename().wstring();
}

// HKLM, then HKCU: ...\App Paths\<exe> names the full executable path.
std::wstring AppPathsExecutable(const wchar_t* executable) {
    const std::wstring key =
        std::wstring(L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\") + executable;
    for (HKEY root : {HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER}) {
        wchar_t value[MAX_PATH * 2] = {};
        DWORD bytes = sizeof(value);
        if (RegGetValueW(root, key.c_str(), nullptr, RRF_RT_REG_SZ, nullptr, value, &bytes) ==
            ERROR_SUCCESS) {
            const std::wstring path = Unquote(value);
            if (IsExistingFile(path) && SameText(FileName(path), executable)) {
                return path;
            }
        }
    }
    return {};
}

std::wstring AssocString(ASSOCSTR kind, const wchar_t* association) {
    DWORD characters = 0;
    if (AssocQueryStringW(
            ASSOCF_INIT_IGNOREUNKNOWN | ASSOCF_NOTRUNCATE, kind, association, L"open",
            nullptr, &characters) != S_FALSE ||
        characters == 0 || characters > 32768) {
        return {};
    }
    std::wstring value(characters, L'\0');
    if (FAILED(AssocQueryStringW(
            ASSOCF_INIT_IGNOREUNKNOWN | ASSOCF_NOTRUNCATE, kind, association, L"open",
            value.data(), &characters))) {
        return {};
    }
    value.resize(wcsnlen(value.c_str(), value.size()));
    return value;
}

std::wstring KnownFolder(REFKNOWNFOLDERID folder) {
    wchar_t* raw = nullptr;
    std::wstring path;
    if (SUCCEEDED(SHGetKnownFolderPath(folder, 0, nullptr, &raw)) && raw != nullptr) {
        path = raw;
    }
    CoTaskMemFree(raw);
    return path;
}

std::wstring FindWord() {
    std::wstring path = AppPathsExecutable(L"WINWORD.EXE");
    if (path.empty()) {
        const std::wstring associated =
            AssocString(ASSOCSTR_EXECUTABLE, L"Word.Document.12");
        if (IsExistingFile(associated) && SameText(FileName(associated), L"WINWORD.EXE")) {
            path = associated;
        }
    }
    return path;
}

std::wstring FindLibreOffice() {
    std::wstring path = AppPathsExecutable(L"soffice.exe");
    if (!path.empty()) {
        return path;
    }
    const KNOWNFOLDERID* folders[] = {&FOLDERID_ProgramFiles, &FOLDERID_ProgramFilesX86};
    for (const KNOWNFOLDERID* folder : folders) {
        const std::wstring root = KnownFolder(*folder);
        if (root.empty()) {
            continue;
        }
        const std::wstring candidate =
            (std::filesystem::path(root) / L"LibreOffice" / L"program" / L"soffice.exe").wstring();
        if (IsExistingFile(candidate)) {
            return candidate;
        }
    }
    return {};
}

bool IsSelf(const std::wstring& executable) {
    if (SameText(FileName(executable), L"LeanDoc.exe")) {
        return true;
    }
    const std::wstring self = ExecutablePath();
    return !self.empty() && SameText(CanonicalPath(executable), CanonicalPath(self));
}

// The handler Windows uses for files of this type, unless it is the "How do
// you want to open this file?" picker.
std::wstring DefaultHandler(const wchar_t* extension) {
    const std::wstring executable = AssocString(ASSOCSTR_EXECUTABLE, extension);
    if (!IsExistingFile(executable) || SameText(FileName(executable), L"OpenWith.exe")) {
        return {};
    }
    return executable;
}

}  // namespace

EditorChoice ResolveEditor() {
    EditorCandidates candidates;
    candidates.word = FindWord();
    candidates.libreOffice = FindLibreOffice();
    candidates.defaultApp = DefaultHandler(L".docx");
    if (!candidates.defaultApp.empty()) {
        candidates.defaultIsSelf = IsSelf(candidates.defaultApp);
        candidates.defaultAppName = AssocString(ASSOCSTR_FRIENDLYAPPNAME, L".docx");
    }
    return ChooseEditor(candidates, [](const std::wstring& name) { return WideToUtf8(name); });
}

LaunchResult LaunchEditor(const EditorChoice& choice, const std::wstring& path) {
    if (choice.kind == EditorKind::Web) {
        const auto result = reinterpret_cast<INT_PTR>(ShellExecuteW(
            nullptr, L"open", choice.target.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        return result > 32 ? LaunchResult::OpenedWeb : LaunchResult::Failed;
    }

    std::wstring executable = choice.target;
    if (choice.kind == EditorKind::Default) {
        // The default can differ by extension, for example .odt.
        const std::wstring extension = std::filesystem::path(path).extension().wstring();
        const std::wstring specific = DefaultHandler(extension.c_str());
        if (!specific.empty() && !IsSelf(specific)) {
            executable = specific;
        }
    }
    if (!IsExistingFile(executable) || IsSelf(executable)) {
        return LaunchResult::Failed;
    }

    // An argument vector, quoted for CommandLineToArgvW, never a shell string.
    std::wstring commandLine = BuildCommandLine({executable, path});
    const std::wstring directory = std::filesystem::path(path).parent_path().wstring();
    STARTUPINFOW startup = {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {};
    if (!CreateProcessW(
            executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE,
            CREATE_UNICODE_ENVIRONMENT, nullptr,
            directory.empty() ? nullptr : directory.c_str(), &startup, &process)) {
        return LaunchResult::Failed;
    }
    AllowSetForegroundWindow(process.dwProcessId);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return LaunchResult::Started;
}

}  // namespace leandoc::windows_host
