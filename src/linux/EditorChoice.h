#pragma once

// The "Open in ..." resolution order from SPEC section 5, kept free of GTK so
// tests/hosts/LinuxEditorChoiceTests.cpp can check it directly. The host fills
// EditorCandidates once per launch from PATH and GIO, then calls ChooseEditor.

#include <string>

namespace leandoc::linux_host {

enum class EditorKind { Word, LibreOffice, Pages, Default, Web };

// Word for the web. The file cannot be handed to it, so the host also shows a
// status message that says the file must be uploaded there.
constexpr char kWordForTheWebUrl[] = "https://www.office.com/launch/word";

struct EditorCandidates {
    // An absolute executable path or a desktop file ID; empty when absent.
    std::string libreOffice;
    bool libreOfficeIsDesktopId = false;
    // The default application for Word documents, as a desktop file ID.
    std::string defaultApp;
    std::string defaultAppName;
    // True when the default application is LeanDoc itself, which must never
    // be offered as the editor.
    bool defaultIsSelf = false;
};

struct EditorChoice {
    EditorKind kind = EditorKind::Web;
    std::string label;
    std::string target;
    bool targetIsDesktopId = false;
};

inline const char* EditorKindName(EditorKind kind) {
    switch (kind) {
        case EditorKind::Word:
            return "word";
        case EditorKind::LibreOffice:
            return "libreoffice";
        case EditorKind::Pages:
            return "pages";
        case EditorKind::Default:
            return "default";
        default:
            return "web";
    }
}

// Linux has no Microsoft Word, so the order starts at LibreOffice: then the
// system default for Word documents when it is not LeanDoc, then the browser.
inline EditorChoice ChooseEditor(const EditorCandidates& candidates) {
    EditorChoice choice;
    if (!candidates.libreOffice.empty()) {
        choice.kind = EditorKind::LibreOffice;
        choice.label = "Open in LibreOffice";
        choice.target = candidates.libreOffice;
        choice.targetIsDesktopId = candidates.libreOfficeIsDesktopId;
        return choice;
    }
    if (!candidates.defaultApp.empty() && !candidates.defaultIsSelf) {
        choice.kind = EditorKind::Default;
        choice.label = candidates.defaultAppName.empty()
                           ? std::string("Open with default app")
                           : "Open in " + candidates.defaultAppName;
        choice.target = candidates.defaultApp;
        choice.targetIsDesktopId = true;
        return choice;
    }
    choice.kind = EditorKind::Web;
    choice.label = "Open Word for the web";
    choice.target = kWordForTheWebUrl;
    return choice;
}

}  // namespace leandoc::linux_host
