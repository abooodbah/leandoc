// The reader settings every host saves and sends to the reader page, with the
// same names on Windows, Linux, and macOS. Header only, so the host logic
// tests check exactly what the hosts compile.
#pragma once

#include <cstddef>
#include <initializer_list>
#include <string_view>

namespace leandoc::settings {

// Reader themes, as in LeanMark: Dim and Dusk are softer dark themes with less
// contrast than Dark. The names are what every host saves and what the reader
// page uses.
enum class Theme { System, Light, Dark, Dim, Dusk };

struct Rgb {
    unsigned char red = 0;
    unsigned char green = 0;
    unsigned char blue = 0;
};

inline bool EqualsIgnoringAsciiCase(std::string_view left, std::string_view right) {
    if (left.size() != right.size()) {
        return false;
    }
    for (std::size_t index = 0; index < left.size(); ++index) {
        char a = left[index];
        char b = right[index];
        if (a >= 'A' && a <= 'Z') {
            a = static_cast<char>(a - 'A' + 'a');
        }
        if (b >= 'A' && b <= 'Z') {
            b = static_cast<char>(b - 'A' + 'a');
        }
        if (a != b) {
            return false;
        }
    }
    return true;
}

inline const char* ThemeName(Theme theme) {
    switch (theme) {
        case Theme::Light:
            return "light";
        case Theme::Dark:
            return "dark";
        case Theme::Dim:
            return "dim";
        case Theme::Dusk:
            return "dusk";
        default:
            return "system";
    }
}

// A saved or page-requested theme name, ignoring ASCII case. Anything else,
// including a name from a later version, gives System.
inline Theme ParseTheme(std::string_view name) {
    for (const Theme theme : {Theme::Light, Theme::Dark, Theme::Dim, Theme::Dusk}) {
        if (EqualsIgnoringAsciiCase(name, ThemeName(theme))) {
            return theme;
        }
    }
    return Theme::System;
}

// Whether the name is one of the five, so a host can refuse anything else.
inline bool IsThemeName(std::string_view name) {
    return ParseTheme(name) != Theme::System || EqualsIgnoringAsciiCase(name, "system");
}

// The theme after this one on the theme button and Ctrl+Shift+T: System,
// Light, Dark, Dim, Dusk, then System again.
inline Theme NextTheme(Theme theme) {
    switch (theme) {
        case Theme::System:
            return Theme::Light;
        case Theme::Light:
            return Theme::Dark;
        case Theme::Dark:
            return Theme::Dim;
        case Theme::Dim:
            return Theme::Dusk;
        default:
            return Theme::System;
    }
}

// Whether the window frame should be dark. systemDark is the platform's own
// setting, used only for System.
inline bool IsDarkTheme(Theme theme, bool systemDark) {
    switch (theme) {
        case Theme::Light:
            return false;
        case Theme::System:
            return systemDark;
        default:
            return true;
    }
}

// The window background (--canvas in reader.css, LeanMark's values), painted
// before the page draws so a launch shows no flash of another colour.
inline Rgb ThemeCanvas(Theme theme, bool systemDark) {
    if (theme == Theme::System) {
        theme = systemDark ? Theme::Dark : Theme::Light;
    }
    switch (theme) {
        case Theme::Dark:
            return {0x0e, 0x0d, 0x0b};
        case Theme::Dim:
            return {0x1e, 0x20, 0x23};
        case Theme::Dusk:
            return {0x22, 0x1e, 0x19};
        default:
            return {0xfa, 0xf9, 0xf7};
    }
}

}  // namespace leandoc::settings
