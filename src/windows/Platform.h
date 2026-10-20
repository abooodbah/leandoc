#pragma once

#include <cstdint>
#include <string>
#include <string_view>

#include "core/DocCore.h"

namespace leandoc::windows_host {

std::wstring Utf8ToWide(std::string_view value);
std::string WideToUtf8(std::wstring_view value);

// Resolves a path so two spellings of one file compare equal.
std::wstring CanonicalPath(const std::wstring& requestedPath);
std::wstring ExecutablePath();
std::wstring ExecutableDirectory();
std::wstring LocalAppDataDirectory();

// Reads the file the way LeanMark does, sharing read, write, and delete so an
// editor that holds the file open is never blocked, within the core's input
// limit, and hands the bytes to the core.
core::OpenResult OpenDocumentWithSharing(const std::wstring& path);

}  // namespace leandoc::windows_host
