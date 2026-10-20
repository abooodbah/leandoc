#pragma once

// The page's context menu keeps only copy and text-editing items. WebView2's
// own items such as "Save link as", "Open link in new window", and "Save
// image as" would fetch what the document points to. Plain C++ so
// tests/hosts/HostLogicTests.cpp checks the list on every platform.

#include <array>
#include <string_view>

namespace leandoc::windows_host {

// Names from ICoreWebView2ContextMenuItem::get_Name.
inline bool IsAllowedContextMenuItem(std::wstring_view name) {
    static constexpr std::array<std::wstring_view, 8> kAllowed = {
        L"copy", L"copyLinkLocation", L"cut", L"paste", L"pasteAndMatchStyle",
        L"selectAll", L"undo", L"redo"};
    for (const std::wstring_view allowed : kAllowed) {
        if (name == allowed) {
            return true;
        }
    }
    return false;
}

}  // namespace leandoc::windows_host
