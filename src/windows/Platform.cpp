#include "Platform.h"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <filesystem>
#include <limits>

namespace leandoc::windows_host {
namespace {

core::OpenResult ReadFailure(const char* code, const char* message, std::uint64_t bytes = 0) {
    core::OpenResult result;
    result.ok = false;
    result.errorCode = code;
    result.errorMessage = message;
    result.sourceBytes = bytes;
    return result;
}

}  // namespace

std::wstring Utf8ToWide(std::string_view value) {
    if (value.empty() ||
        value.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return {};
    }
    const int required = MultiByteToWideChar(
        CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (required <= 0) {
        return {};
    }
    std::wstring output(static_cast<std::size_t>(required), L'\0');
    MultiByteToWideChar(
        CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        output.data(), required);
    return output;
}

std::string WideToUtf8(std::wstring_view value) {
    if (value.empty() ||
        value.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return {};
    }
    const int required = WideCharToMultiByte(
        CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (required <= 0) {
        return {};
    }
    std::string output(static_cast<std::size_t>(required), '\0');
    WideCharToMultiByte(
        CP_UTF8, 0, value.data(), static_cast<int>(value.size()), output.data(), required,
        nullptr, nullptr);
    return output;
}

std::wstring CanonicalPath(const std::wstring& requestedPath) {
    std::error_code error;
    const auto canonical =
        std::filesystem::weakly_canonical(std::filesystem::path(requestedPath), error);
    if (!error) {
        return canonical.wstring();
    }
    const DWORD required = GetFullPathNameW(requestedPath.c_str(), 0, nullptr, nullptr);
    if (required == 0) {
        return requestedPath;
    }
    std::wstring fullPath(required, L'\0');
    const DWORD written =
        GetFullPathNameW(requestedPath.c_str(), required, fullPath.data(), nullptr);
    if (written == 0 || written >= required) {
        return requestedPath;
    }
    fullPath.resize(written);
    return fullPath;
}

std::wstring ExecutablePath() {
    std::wstring path(32768, L'\0');
    const DWORD length =
        GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (length == 0 || length >= path.size()) {
        return {};
    }
    path.resize(length);
    return path;
}

std::wstring ExecutableDirectory() {
    const std::wstring path = ExecutablePath();
    if (path.empty()) {
        return L".";
    }
    return std::filesystem::path(path).parent_path().wstring();
}

std::wstring LocalAppDataDirectory() {
    wchar_t* rawPath = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &rawPath))) {
        CoTaskMemFree(rawPath);
        return ExecutableDirectory();
    }
    std::wstring path(rawPath);
    CoTaskMemFree(rawPath);
    return path;
}

core::OpenResult OpenDocumentWithSharing(const std::wstring& path) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES ||
        (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
        return ReadFailure("read-failed", "LeanDoc could not find this file.");
    }
    HANDLE file = CreateFileW(
        path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return ReadFailure("read-failed", "LeanDoc could not read this file.");
    }
    // Only regular disk files are read; a device or pipe is refused.
    if (GetFileType(file) != FILE_TYPE_DISK) {
        CloseHandle(file);
        return ReadFailure("read-failed", "LeanDoc opens regular files only.");
    }
    LARGE_INTEGER size = {};
    if (!GetFileSizeEx(file, &size) || size.QuadPart < 0) {
        CloseHandle(file);
        return ReadFailure("read-failed", "LeanDoc could not measure this file.");
    }
    const core::Limits limits;
    const auto bytes = static_cast<std::uint64_t>(size.QuadPart);
    if (bytes > limits.maximumInputBytes) {
        CloseHandle(file);
        return ReadFailure(
            "too-large", "This file is larger than LeanDoc's 256 MiB safety limit.", bytes);
    }

    std::string content(static_cast<std::size_t>(bytes), '\0');
    std::size_t total = 0;
    while (total < content.size()) {
        const DWORD request = static_cast<DWORD>(
            std::min<std::size_t>(content.size() - total, 16u * 1024u * 1024u));
        DWORD read = 0;
        if (!ReadFile(file, content.data() + total, request, &read, nullptr)) {
            CloseHandle(file);
            return ReadFailure("read-failed", "LeanDoc could not finish reading this file.");
        }
        if (read == 0) {
            break;
        }
        total += read;
    }
    CloseHandle(file);
    content.resize(total);
    return core::OpenDocumentBytes(content, limits);
}

}  // namespace leandoc::windows_host
