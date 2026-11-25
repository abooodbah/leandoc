// The strings the hosts draw themselves: the Windows error boxes, the file
// dialogs on every platform, and the macOS menus. Each is UTF-8 in English,
// Simplified Chinese, and Japanese; the reader page's own strings are in
// assets/fidelity.js under the same keys (native.*), and
// tests/reader/localization.test.mjs checks that the two agree. Header only,
// so the host logic tests check exactly what the hosts compile.
#pragma once

#include <string_view>

namespace leandoc::interface_text {

struct NativeText {
    const char* english;
    const char* chinese;
    const char* japanese;
};

// The text in an interface language from ResolveInterfaceLanguage ("en",
// "zh-CN", or "ja"). English for anything else, and for a string with no
// translation.
inline const char* Localized(const NativeText& text, std::string_view language) {
    const char* chosen = language == "zh-CN" ? text.chinese : language == "ja" ? text.japanese : text.english;
    return chosen != nullptr && chosen[0] != '\0' ? chosen : text.english;
}

// native.couldNotStart: Windows error box title
inline constexpr NativeText kCouldNotStart = {"LeanDoc could not start", "LeanDoc 无法启动", "LeanDoc を起動できませんでした"};

// native.needsWebView2: Windows error box
inline constexpr NativeText kNeedsWebView2 = {"LeanDoc needs the Microsoft Edge WebView2 Runtime. Install or repair WebView2, then try again.", "LeanDoc 需要 Microsoft Edge WebView2 Runtime。请安装或修复 WebView2，然后重试。", "LeanDoc には Microsoft Edge WebView2 ランタイムが必要です。WebView2 をインストールまたは修復してから、もう一度お試しください。"};

// native.noReaderSurface: Windows error box
inline constexpr NativeText kNoReaderSurface = {"Windows could not create LeanDoc's reader surface.", "Windows 无法创建 LeanDoc 的阅读界面。", "Windows は LeanDoc の表示領域を作成できませんでした。"};

// native.webView2Failed: Windows error box
inline constexpr NativeText kWebView2Failed = {"LeanDoc could not initialize the WebView2 Runtime.", "LeanDoc 无法初始化 WebView2 Runtime。", "LeanDoc は WebView2 ランタイムを初期化できませんでした。"};

// native.openTitle: file dialog title (all platforms)
inline constexpr NativeText kOpenTitle = {"Open documents", "打开文档", "ドキュメントを開く"};

// native.wordDocuments: file dialog filter name (Windows, Linux)
inline constexpr NativeText kWordDocuments = {"Word documents", "Word 文档", "Word ドキュメント"};

// native.allFiles: file dialog filter name (Windows, Linux)
inline constexpr NativeText kAllFiles = {"All files", "所有文件", "すべてのファイル"};

// native.readOnly: macOS error alert
inline constexpr NativeText kReadOnly = {"LeanDoc is a read-only viewer and does not save documents.", "LeanDoc 是只读查看器，不会保存文档。", "LeanDoc は読み取り専用のビューアーで、ドキュメントを保存しません。"};

// native.unsupportedType: macOS error alert when a file of another type is opened
inline constexpr NativeText kUnsupportedType = {"LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.", "LeanDoc 可以打开 .docx、.dotx、.docm、.dotm、.doc、.rtf 和 .odt 文件。", "LeanDoc で開けるのは .docx、.dotx、.docm、.dotm、.doc、.rtf、.odt ファイルです。"};

// native.menuAbout: macOS app menu
inline constexpr NativeText kMenuAbout = {"About LeanDoc", "关于 LeanDoc", "LeanDoc について"};

// native.menuServices: macOS app menu (standard macOS name)
inline constexpr NativeText kMenuServices = {"Services", "服务", "サービス"};

// native.menuHide: macOS app menu
inline constexpr NativeText kMenuHide = {"Hide LeanDoc", "隐藏 LeanDoc", "LeanDoc を非表示"};

// native.menuHideOthers: macOS app menu
inline constexpr NativeText kMenuHideOthers = {"Hide Others", "隐藏其他", "ほかを非表示"};

// native.menuShowAll: macOS app menu
inline constexpr NativeText kMenuShowAll = {"Show All", "全部显示", "すべてを表示"};

// native.menuQuit: macOS app menu
inline constexpr NativeText kMenuQuit = {"Quit LeanDoc", "退出 LeanDoc", "LeanDoc を終了"};

// native.menuFile: macOS menu bar
inline constexpr NativeText kMenuFile = {"File", "文件", "ファイル"};

// native.menuOpen: macOS File menu (keep the ellipsis)
inline constexpr NativeText kMenuOpen = {"Open…", "打开…", "開く…"};

// native.menuClose: macOS File menu
inline constexpr NativeText kMenuClose = {"Close", "关闭", "閉じる"};

// native.menuEdit: macOS menu bar
inline constexpr NativeText kMenuEdit = {"Edit", "编辑", "編集"};

// native.menuCopy: macOS Edit menu
inline constexpr NativeText kMenuCopy = {"Copy", "拷贝", "コピー"};

// native.menuSelectAll: macOS Edit menu
inline constexpr NativeText kMenuSelectAll = {"Select All", "全选", "すべてを選択"};

// native.menuWindow: macOS menu bar
inline constexpr NativeText kMenuWindow = {"Window", "窗口", "ウィンドウ"};

// native.menuMinimize: macOS Window menu
inline constexpr NativeText kMenuMinimize = {"Minimize", "最小化", "しまう"};

// native.menuZoom: macOS Window menu: resize the window (not text zoom)
inline constexpr NativeText kMenuZoom = {"Zoom", "缩放", "拡大/縮小"};

// native.menuBringAllToFront: macOS Window menu
inline constexpr NativeText kMenuBringAllToFront = {"Bring All to Front", "前置全部窗口", "すべてを手前に移動"};

}  // namespace leandoc::interface_text
