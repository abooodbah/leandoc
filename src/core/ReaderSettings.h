// The reader settings every host saves and sends to the reader page, with the
// same names on Windows, Linux, and macOS: theme, page colour, and interface
// language. Header only, so the host logic
// tests check exactly what the hosts compile.
#pragma once

#include <cstddef>
#include <initializer_list>
#include <string>
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

// The page colour: white like paper (the default, as in 0.1), or the theme's
// colours. Saved as PageColor (LeanDocPageColor on macOS).
enum class PageColor { Paper, Theme };

inline const char* PageColorName(PageColor color) {
    return color == PageColor::Theme ? "theme" : "paper";
}

// A saved or page-requested name, ignoring ASCII case. Anything else,
// including a missing value from 0.1, gives Paper.
inline PageColor ParsePageColor(std::string_view name) {
    return EqualsIgnoringAsciiCase(name, "theme") ? PageColor::Theme : PageColor::Paper;
}

inline bool IsPageColorName(std::string_view name) {
    return EqualsIgnoringAsciiCase(name, "paper") || EqualsIgnoringAsciiCase(name, "theme");
}

// The interface language: System follows the platform's language, or the
// reader picks English, Simplified Chinese, or Japanese in the settings panel.
// Saved as Language (LeanDocLanguage on macOS) under these names, which the
// reader page uses too. The page's copy of the rules is in assets/fidelity.js.
enum class Language { System, English, ChineseSimplified, Japanese };

inline const char* LanguageName(Language language) {
    switch (language) {
        case Language::English:
            return "en";
        case Language::ChineseSimplified:
            return "zh-CN";
        case Language::Japanese:
            return "ja";
        default:
            return "system";
    }
}

// A saved or page-requested language, ignoring ASCII case. Anything else,
// including a missing value from 0.3 or a language from a later version,
// gives System.
inline Language ParseLanguage(std::string_view name) {
    for (const Language language :
         {Language::English, Language::ChineseSimplified, Language::Japanese}) {
        if (EqualsIgnoringAsciiCase(name, LanguageName(language))) {
            return language;
        }
    }
    return Language::System;
}

inline bool IsLanguageName(std::string_view name) {
    return ParseLanguage(name) != Language::System || EqualsIgnoringAsciiCase(name, "system");
}

// The interface language for a system language tag such as ja-JP, zh-Hans-CN,
// or a POSIX locale such as zh_CN.UTF-8, by LeanMark's rule: Japanese for ja;
// Simplified Chinese for zh, zh-CN, zh-SG, and zh-Hans tags; English for
// Traditional Chinese (zh-TW, zh-HK, zh-MO, zh-Hant), which has no interface
// of its own, and for anything else.
inline const char* SystemInterfaceLanguage(std::string_view tag) {
    const std::size_t end = tag.find_first_of(".@");
    std::string lower(tag.substr(0, end == std::string_view::npos ? tag.size() : end));
    for (char& character : lower) {
        if (character == '_') {
            character = '-';
        } else if (character >= 'A' && character <= 'Z') {
            character = static_cast<char>(character - 'A' + 'a');
        }
    }
    const auto primary = [&lower](std::string_view code) {
        return lower.compare(0, code.size(), code) == 0 &&
               (lower.size() == code.size() || lower[code.size()] == '-');
    };
    if (primary("ja")) {
        return "ja";
    }
    if (!primary("zh")) {
        return "en";
    }
    const std::string rest = "-" + lower.substr(2) + "-";
    if (rest.find("-hant-") != std::string::npos) {
        return "en";
    }
    if (rest.find("-hans-") != std::string::npos) {
        return "zh-CN";
    }
    for (const char* region : {"-tw-", "-hk-", "-mo-"}) {
        if (rest.find(region) != std::string::npos) {
            return "en";
        }
    }
    return "zh-CN";
}

inline const char* ResolveInterfaceLanguage(Language setting, std::string_view systemTag) {
    return setting == Language::System ? SystemInterfaceLanguage(systemTag) : LanguageName(setting);
}

// The reader page in the interface language: hosts open reader.html?lang=<it>
// so the first paint is already translated.
inline std::string ReaderUrl(std::string_view base, Language setting, std::string_view systemTag) {
    std::string url(base);
    url += "?lang=";
    url += ResolveInterfaceLanguage(setting, systemTag);
    return url;
}

// Whether a URI is the reader page: the base URL (ignoring ASCII case, as
// hosts compare it), alone or with exactly one of the three language queries.
inline bool IsReaderUrl(std::string_view uri, std::string_view base) {
    if (uri.size() < base.size() || !EqualsIgnoringAsciiCase(uri.substr(0, base.size()), base)) {
        return false;
    }
    const std::string_view query = uri.substr(base.size());
    return query.empty() || query == "?lang=en" || query == "?lang=zh-CN" || query == "?lang=ja";
}

}  // namespace leandoc::settings
