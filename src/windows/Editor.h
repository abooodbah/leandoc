#pragma once

#include <windows.h>

#include <string>

#include "EditorChoice.h"

namespace leandoc::windows_host {

// Looks for Word, LibreOffice, and the default .docx handler once per launch.
EditorChoice ResolveEditor();

enum class LaunchResult { Started, OpenedWeb, Failed };

// Starts the chosen editor on `path` with CreateProcessW and a quoted argument
// vector. Word for the web opens in the browser through ShellExecuteW.
LaunchResult LaunchEditor(const EditorChoice& choice, const std::wstring& path);

}  // namespace leandoc::windows_host
