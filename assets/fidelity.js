// The interface strings in English, Simplified Chinese, and Japanese, and the
// wording for the fidelity bar and the fallback pages. Pure functions, usable
// in the page (window.LeanDocText) and in Node for unit tests.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LeanDocText = api;
  }
}(this, function () {
  "use strict";

  // BEGIN interface strings
  // The interface in English, Simplified Chinese, and Japanese. English is
  // the fallback for any key another table lacks. reader.html starts in
  // English and marks each string with data-i18n (text) or
  // data-i18n-<attribute>. Keys stay ASCII; {name} placeholders are filled by
  // text(). Key names such as Ctrl+Shift+T stay as they are printed on the
  // keys. host.* and core.* are the messages the hosts and the core send in
  // English, looked up by that English; native.* are drawn by the hosts from
  // src/core/InterfaceText.h and kept here so one test checks every string.
  // tests/reader/localization.test.mjs checks the tables.
  var interfaceStrings = (function () {
    var tables = {
      en: {
        "app.currentDocument": "Current document",
        "app.tagline": "Word document reader",
        "toolbar.label": "Reader controls",
        "find.label": "Find in document",
        "find.placeholder": "Find",
        "find.title": "Find in document (Ctrl+F, F3)",
        "view.label": "View",
        "view.page": "Page",
        "view.pageTitle": "Page view (Ctrl+Shift+V)",
        "view.reading": "Reading",
        "view.readingTitle": "Reading view (Ctrl+Shift+V)",
        "zoom.label": "Zoom",
        "zoom.out": "Zoom out",
        "zoom.outTitle": "Zoom out (Ctrl+-)",
        "zoom.in": "Zoom in",
        "zoom.inTitle": "Zoom in (Ctrl++)",
        "zoom.valueTitle": "Fit width or 100% (Ctrl+0)",
        "zoom.valueLabelAuto": "Zoom {percent}. Activate for fit width.",
        "zoom.valueLabelFit": "Zoom {percent}, fit width. Activate for 100%.",
        "zoom.autoTitle": "Activate to fit width (Ctrl+0 resets)",
        "zoom.fitTitle": "Fit width. Activate for 100% (Ctrl+0 resets)",
        "theme.system": "System",
        "theme.light": "Light",
        "theme.dark": "Dark",
        "theme.dim": "Dim",
        "theme.dusk": "Dusk",
        "theme.systemShown": "System ({theme})",
        "theme.buttonLabel": "Theme: {name}. Activate to change theme.",
        "theme.buttonTitle": "Theme: {name} (Ctrl+Shift+T)",
        "settings.buttonLabel": "Settings and keyboard shortcuts",
        "settings.buttonTitle": "Settings and shortcuts (Ctrl+/)",
        "open.button": "Open",
        "open.title": "Open a document (Ctrl+O)",
        "tabs.label": "Open documents",
        "tabs.closeTitle": "Close (Ctrl+W)",
        "fidelity.label": "Fidelity notes",
        "fidelity.details": "Details",
        "fidelity.hideDetails": "Hide details",
        "fidelity.collapse": "Collapse",
        "fidelity.expand": "Expand",
        "fidelity.collapseLabel": "Collapse fidelity notes",
        "fidelity.expandLabel": "Expand fidelity notes",
        "outline.label": "Document outline",
        "outline.title": "Outline",
        "outline.hide": "Hide outline",
        "outline.show": "Show outline",
        "outline.untitled": "Untitled section",
        "document.label": "Document",
        "empty.title": "Read Word documents without opening an office suite.",
        "empty.message": "Open a .docx file to read it here. LeanDoc does not run macros or fetch anything the document points to.",
        "empty.openButton": "Open a document",
        "fallback.openButton": "Open another document",
        "recent.title": "Recent",
        "recent.clear": "Clear recent",
        "recent.itemLabel": "Open {name}, {path}",
        "settings.title": "Settings",
        "settings.close": "Close settings",
        "settings.closeTitle": "Close (Esc)",
        "settings.theme": "Theme",
        "settings.view": "View",
        "settings.pageColor": "Page colour",
        "settings.paper": "White, like paper",
        "settings.themeColours": "The theme's colours",
        "settings.fitWidth": "Fit width",
        "settings.reset": "Reset",
        "settings.shortcuts": "Keyboard shortcuts",
        "settings.language": "Language",
        "settings.languageSystem": "System",
        "identity.untitled": "Untitled",
        "identity.notShown": "Not shown",
        "identity.opening": "Opening",
        "identity.onePage": "1 page",
        "identity.pages": "{count} pages",
        "identity.readingView": "Reading view",
        "fallback.notShownTitle": "This document could not be shown",
        "fallback.layoutFailed": "LeanDoc could not lay out this document.",
        "link.blocked": "LeanDoc opens only web and email links.",
        "copy.done": "Document copied as text.",
        "copy.failed": "LeanDoc could not copy to the clipboard.",
        "status.rendererMissing": "LeanDoc could not load its document renderer.",
        "editor.openIn": "Open in {name}",
        "editor.openDefault": "Open with default app",
        "editor.openWeb": "Open Word for the web",
        "editor.title": "{label} (Ctrl+Shift+E)",
        "group.reader": "Reader",
        "group.settings": "Settings panel",
        "group.tabs": "Tabs",
        "group.find": "Find box",
        "group.tabStrip": "Tab strip",
        "group.menu": "Menu",
        "shortcut.open": "Open a document",
        "shortcut.find": "Find in the document",
        "shortcut.nextMatch": "Next match",
        "shortcut.previousMatch": "Previous match",
        "shortcut.reload": "Reload from disk",
        "shortcut.switchView": "Switch page and reading view",
        "shortcut.theme": "Change the theme",
        "shortcut.editor": "Open in the editor",
        "shortcut.copy": "Copy all text",
        "shortcut.zoomIn": "Zoom in",
        "shortcut.zoomOut": "Zoom out",
        "shortcut.zoomReset": "Reset the zoom",
        "shortcut.settings": "Settings and shortcuts",
        "shortcut.closePanel": "Close the settings panel",
        "shortcut.nextTab": "Next tab",
        "shortcut.previousTab": "Previous tab",
        "shortcut.closeTab": "Close the tab",
        "shortcut.tabByPosition": "Go to a tab by position",
        "shortcut.lastTab": "Go to the last tab",
        "shortcut.clearSearch": "Clear the search",
        "shortcut.firstTab": "First tab",
        "shortcut.lastTabStrip": "Last tab",
        "shortcut.closeWindow": "Close the window",
        "shortcut.minimize": "Minimize the window",
        "shortcut.hide": "Hide LeanDoc",
        "shortcut.quit": "Quit LeanDoc",
        "key.tabRange": "Ctrl+1 to Ctrl+8",
        "key.rightArrow": "Right arrow",
        "key.leftArrow": "Left arrow",
        "list.pair": " and ",
        "list.separator": ", ",
        "list.last": ", and ",
        "fidelity.count": "{count} {noun}",
        "fidelity.hiddenSentence": "This document contains {list} that LeanDoc does not display.",
        "fidelity.alsoSentence": "It also contains {list}.",
        "fidelity.containsSentence": "This document contains {list}.",
        "fidelity.summaryHidden": "Some content in this document is not displayed.",
        "fidelity.summaryNotice": "This document has a notice.",
        "fidelity.summaryNotices": "This document has notices.",
        "fidelity.statusNotDisplayed": "Not displayed",
        "fidelity.statusNoted": "Noted",
        "notice.tracked-changes.phrase": "tracked changes (shown as accepted)",
        "notice.tracked-changes.status": "Shown as accepted",
        "notice.comments.phrase": "comments (hidden)",
        "notice.comments.status": "Hidden",
        "notice.macros.phrase": "macros (not run)",
        "notice.macros.status": "Not run",
        "notice.remote-template.phrase": "a remote template (not fetched)",
        "notice.remote-template.status": "Not fetched",
        "notice.remote-image.phrase": "remote images (not fetched)",
        "notice.remote-image.status": "Not fetched",
        "notice.external-content.phrase": "external content (not fetched)",
        "notice.external-content.status": "Not fetched",
        "notice.dde-field.phrase": "DDE fields (not run)",
        "notice.dde-field.status": "Not run",
        "notice.embedded-fonts.phrase": "embedded fonts (system fonts used)",
        "notice.embedded-fonts.status": "System fonts used",
        "noun.text-box.one": "text box",
        "noun.text-box.other": "text boxes",
        "noun.equation.one": "equation",
        "noun.equation.other": "equations",
        "noun.chart.one": "chart",
        "noun.chart.other": "charts",
        "noun.smart-art.one": "SmartArt graphic",
        "noun.smart-art.other": "SmartArt graphics",
        "noun.shape.one": "shape",
        "noun.shape.other": "shapes",
        "noun.ole-object.one": "embedded object",
        "noun.ole-object.other": "embedded objects",
        "noun.activex.one": "ActiveX control",
        "noun.activex.other": "ActiveX controls",
        "noun.alt-chunk.one": "imported content block",
        "noun.alt-chunk.other": "imported content blocks",
        "noun.tracked-changes.one": "tracked change",
        "noun.tracked-changes.other": "tracked changes",
        "noun.comments.one": "comment",
        "noun.comments.other": "comments",
        "noun.macros.one": "macro project",
        "noun.macros.other": "macro projects",
        "noun.remote-template.one": "remote template",
        "noun.remote-template.other": "remote templates",
        "noun.remote-image.one": "remote image",
        "noun.remote-image.other": "remote images",
        "noun.external-content.one": "external content link",
        "noun.external-content.other": "external content links",
        "noun.dde-field.one": "DDE field",
        "noun.dde-field.other": "DDE fields",
        "noun.embedded-fonts.one": "embedded font",
        "noun.embedded-fonts.other": "embedded fonts",
        "kind.legacy-doc.title": "Word 97-2003 document",
        "kind.legacy-doc.message": "This is a Word 97-2003 document (.doc). LeanDoc 0.1 reads .docx files only.",
        "kind.encrypted-ooxml.title": "Password-protected document",
        "kind.encrypted-ooxml.message": "This document is password protected. LeanDoc does not open protected documents.",
        "kind.rtf.title": "Rich Text Format document",
        "kind.rtf.message": "This is a Rich Text Format document (.rtf). LeanDoc 0.1 reads .docx files only.",
        "kind.odt.title": "OpenDocument text",
        "kind.odt.message": "This is an OpenDocument text file (.odt). LeanDoc 0.1 reads .docx files only.",
        "kind.not-a-document.title": "Not a Word document",
        "kind.not-a-document.message": "This file is not a Word document. LeanDoc reads .docx files only.",
        "fallback.couldNotOpen": "This document could not be opened",
        "fallback.couldNotRead": "LeanDoc could not read this document.",
        "fallback.couldNotShow": "LeanDoc could not show this document.",
        "error.too-large": "This file is larger than LeanDoc's 256 MB limit.",
        "error.not-a-zip": "This file is not a valid Word document.",
        "error.corrupt-zip": "This document is damaged and cannot be read.",
        "error.too-many-entries": "This document has more parts than LeanDoc reads.",
        "error.part-too-large": "A part of this document is larger than LeanDoc's limit.",
        "error.compression-ratio": "This document expands far beyond its file size, so LeanDoc stopped reading it.",
        "error.unsafe-entry-name": "This document contains a part with an unsafe name, so LeanDoc stopped reading it.",
        "error.duplicate-entry": "This document contains duplicate parts, so LeanDoc stopped reading it.",
        "error.encrypted-entry": "This document contains encrypted parts. LeanDoc does not open protected documents.",
        "error.missing-main-part": "This file has no Word document body.",
        "error.xml-doctype": "This document contains a document type declaration, which LeanDoc refuses to read.",
        "error.xml-malformed": "This document contains malformed XML and cannot be read.",
        "error.xml-too-deep": "This document is nested more deeply than LeanDoc reads.",
        "error.read-failed": "LeanDoc could not read this file.",
        "error.renderer-stopped": "LeanDoc's renderer stopped several times while showing this document. Press F5 to try again.",
        "host.unsupportedType": "LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.",
        "host.tooManyTabs": "LeanDoc keeps at most 64 tabs. Close one to open more.",
        "host.stillChanging": "The file is still changing or cannot be read. Keeping the last complete view.",
        "host.windowsNoPicker": "Windows could not open the file picker.",
        "host.movedOrDeleted": "The file was moved or deleted. The last complete view is still shown.",
        "host.webAndEmailOnly": "LeanDoc opens web and email links only.",
        "host.windowsNoLink": "Windows could not open that link.",
        "host.wordForTheWeb": "Word for the web opened in your browser. Upload the file there to read or edit it.",
        "host.noEditor": "LeanDoc could not start the editor.",
        "host.linuxNoBrowser": "Linux could not open the browser.",
        "host.linuxNoLink": "Linux could not open that link.",
        "host.localFilesOnly": "LeanDoc can open local files only.",
        "host.macNoLink": "macOS could not open that link.",
        "host.macNoBrowser": "macOS could not open the browser.",
        "core.noWordPart": "This file does not contain a Word document part.",
        "core.notWord": "This file is not a Word document.",
        "core.outOfMemory": "LeanDoc ran out of memory while reading this file.",
        "core.notFound": "LeanDoc could not find this file.",
        "core.folder": "That path is a folder, not a document.",
        "core.regularOnly": "LeanDoc can only read regular files.",
        "core.regularFilesOnly": "LeanDoc opens regular files only.",
        "core.noMeasure": "LeanDoc could not measure this file.",
        "core.readFailed": "LeanDoc could not read this file.",
        "core.unfinished": "LeanDoc could not finish reading this file.",
        "core.tooLargeWindows": "This file is larger than LeanDoc's 256 MiB safety limit.",
        "core.dtd": "This document contains a DTD, which LeanDoc refuses to read.",
        "core.tooDeep": "This document's XML is nested more deeply than LeanDoc allows.",
        "core.unsafeName": "This document contains a part with an unsafe name.",
        "core.sameName": "This document contains two parts with the same name.",
        "core.encryptedPart": "This document contains an encrypted part.",
        "core.compression": "This document uses a compression method LeanDoc does not support.",
        "core.overCompressed": "A part of this document is compressed more than LeanDoc allows.",
        "native.couldNotStart": "LeanDoc could not start",
        "native.needsWebView2": "LeanDoc needs the Microsoft Edge WebView2 Runtime. Install or repair WebView2, then try again.",
        "native.noReaderSurface": "Windows could not create LeanDoc's reader surface.",
        "native.webView2Failed": "LeanDoc could not initialize the WebView2 Runtime.",
        "native.openTitle": "Open documents",
        "native.wordDocuments": "Word documents",
        "native.allFiles": "All files",
        "native.readOnly": "LeanDoc is a read-only viewer and does not save documents.",
        "native.unsupportedType": "LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.",
        "native.menuAbout": "About LeanDoc",
        "native.menuServices": "Services",
        "native.menuHide": "Hide LeanDoc",
        "native.menuHideOthers": "Hide Others",
        "native.menuShowAll": "Show All",
        "native.menuQuit": "Quit LeanDoc",
        "native.menuFile": "File",
        "native.menuOpen": "Open…",
        "native.menuClose": "Close",
        "native.menuEdit": "Edit",
        "native.menuCopy": "Copy",
        "native.menuSelectAll": "Select All",
        "native.menuWindow": "Window",
        "native.menuMinimize": "Minimize",
        "native.menuZoom": "Zoom",
        "native.menuBringAllToFront": "Bring All to Front"
      },
      "zh-CN": {
        "app.currentDocument": "当前文档",
        "app.tagline": "Word 文档阅读器",
        "toolbar.label": "阅读器工具栏",
        "find.label": "在文档中查找",
        "find.placeholder": "查找",
        "find.title": "在文档中查找 (Ctrl+F, F3)",
        "view.label": "视图",
        "view.page": "页面",
        "view.pageTitle": "页面视图 (Ctrl+Shift+V)",
        "view.reading": "阅读",
        "view.readingTitle": "阅读视图 (Ctrl+Shift+V)",
        "zoom.label": "缩放",
        "zoom.out": "缩小",
        "zoom.outTitle": "缩小 (Ctrl+-)",
        "zoom.in": "放大",
        "zoom.inTitle": "放大 (Ctrl++)",
        "zoom.valueTitle": "适应宽度或 100% (Ctrl+0)",
        "zoom.valueLabelAuto": "缩放 {percent}。按下可适应宽度。",
        "zoom.valueLabelFit": "缩放 {percent}，适应宽度。按下可切换到 100%。",
        "zoom.autoTitle": "按下可适应宽度（Ctrl+0 重置）",
        "zoom.fitTitle": "适应宽度。按下可切换到 100%（Ctrl+0 重置）",
        "theme.system": "跟随系统",
        "theme.light": "浅色",
        "theme.dark": "深色",
        "theme.dim": "暗淡",
        "theme.dusk": "暮色",
        "theme.systemShown": "跟随系统（{theme}）",
        "theme.buttonLabel": "主题：{name}。按下可切换主题。",
        "theme.buttonTitle": "主题：{name} (Ctrl+Shift+T)",
        "settings.buttonLabel": "设置和键盘快捷键",
        "settings.buttonTitle": "设置和快捷键 (Ctrl+/)",
        "open.button": "打开",
        "open.title": "打开文档 (Ctrl+O)",
        "tabs.label": "已打开的文档",
        "tabs.closeTitle": "关闭 (Ctrl+W)",
        "fidelity.label": "显示效果说明",
        "fidelity.details": "详细信息",
        "fidelity.hideDetails": "隐藏详细信息",
        "fidelity.collapse": "折叠",
        "fidelity.expand": "展开",
        "fidelity.collapseLabel": "折叠显示效果说明",
        "fidelity.expandLabel": "展开显示效果说明",
        "outline.label": "文档大纲",
        "outline.title": "大纲",
        "outline.hide": "隐藏大纲",
        "outline.show": "显示大纲",
        "outline.untitled": "无标题章节",
        "document.label": "文档",
        "empty.title": "无需打开办公套件即可阅读 Word 文档。",
        "empty.message": "打开一个 .docx 文件即可在此阅读。LeanDoc 不会运行宏，也不会获取文档指向的任何内容。",
        "empty.openButton": "打开文档",
        "fallback.openButton": "打开其他文档",
        "recent.title": "最近",
        "recent.clear": "清除最近记录",
        "recent.itemLabel": "打开 {name}，{path}",
        "settings.title": "设置",
        "settings.close": "关闭设置",
        "settings.closeTitle": "关闭 (Esc)",
        "settings.theme": "主题",
        "settings.view": "视图",
        "settings.pageColor": "页面颜色",
        "settings.paper": "白色，如同纸张",
        "settings.themeColours": "使用主题颜色",
        "settings.fitWidth": "适应宽度",
        "settings.reset": "重置",
        "settings.shortcuts": "键盘快捷键",
        "settings.language": "语言",
        "settings.languageSystem": "跟随系统",
        "identity.untitled": "未命名",
        "identity.notShown": "无法显示",
        "identity.opening": "正在打开",
        "identity.onePage": "1 页",
        "identity.pages": "{count} 页",
        "identity.readingView": "阅读视图",
        "fallback.notShownTitle": "无法显示此文档",
        "fallback.layoutFailed": "LeanDoc 无法对此文档进行排版。",
        "link.blocked": "LeanDoc 只打开网页链接和电子邮件链接。",
        "copy.done": "已将文档复制为纯文本。",
        "copy.failed": "LeanDoc 无法复制到剪贴板。",
        "status.rendererMissing": "LeanDoc 无法加载文档渲染器。",
        "editor.openIn": "在 {name} 中打开",
        "editor.openDefault": "用默认应用打开",
        "editor.openWeb": "打开 Word for the web",
        "editor.title": "{label} (Ctrl+Shift+E)",
        "group.reader": "阅读器",
        "group.settings": "设置面板",
        "group.tabs": "标签页",
        "group.find": "查找框",
        "group.tabStrip": "标签栏",
        "group.menu": "菜单",
        "shortcut.open": "打开文档",
        "shortcut.find": "在文档中查找",
        "shortcut.nextMatch": "下一个匹配项",
        "shortcut.previousMatch": "上一个匹配项",
        "shortcut.reload": "从磁盘重新加载",
        "shortcut.switchView": "切换页面视图和阅读视图",
        "shortcut.theme": "切换主题",
        "shortcut.editor": "在编辑器中打开",
        "shortcut.copy": "复制全部文本",
        "shortcut.zoomIn": "放大",
        "shortcut.zoomOut": "缩小",
        "shortcut.zoomReset": "重置缩放",
        "shortcut.settings": "设置和快捷键",
        "shortcut.closePanel": "关闭设置面板",
        "shortcut.nextTab": "下一个标签页",
        "shortcut.previousTab": "上一个标签页",
        "shortcut.closeTab": "关闭标签页",
        "shortcut.tabByPosition": "按位置切换标签页",
        "shortcut.lastTab": "切换到最后一个标签页",
        "shortcut.clearSearch": "清除查找",
        "shortcut.firstTab": "第一个标签页",
        "shortcut.lastTabStrip": "最后一个标签页",
        "shortcut.closeWindow": "关闭窗口",
        "shortcut.minimize": "最小化窗口",
        "shortcut.hide": "隐藏 LeanDoc",
        "shortcut.quit": "退出 LeanDoc",
        "key.tabRange": "Ctrl+1 至 Ctrl+8",
        "key.rightArrow": "右方向键",
        "key.leftArrow": "左方向键",
        "list.pair": "和",
        "list.separator": "、",
        "list.last": "和",
        "fidelity.count": "{count} 个{noun}",
        "fidelity.hiddenSentence": "此文档中有 LeanDoc 不显示的内容：{list}。",
        "fidelity.alsoSentence": "此外还包含：{list}。",
        "fidelity.containsSentence": "此文档包含：{list}。",
        "fidelity.summaryHidden": "此文档中的部分内容未显示。",
        "fidelity.summaryNotice": "此文档有一条说明。",
        "fidelity.summaryNotices": "此文档有多条说明。",
        "fidelity.statusNotDisplayed": "未显示",
        "fidelity.statusNoted": "仅提示",
        "notice.tracked-changes.phrase": "修订（按全部接受显示）",
        "notice.tracked-changes.status": "按已接受显示",
        "notice.comments.phrase": "批注（已隐藏）",
        "notice.comments.status": "已隐藏",
        "notice.macros.phrase": "宏（未运行）",
        "notice.macros.status": "未运行",
        "notice.remote-template.phrase": "远程模板（未获取）",
        "notice.remote-template.status": "未获取",
        "notice.remote-image.phrase": "远程图片（未获取）",
        "notice.remote-image.status": "未获取",
        "notice.external-content.phrase": "外部内容（未获取）",
        "notice.external-content.status": "未获取",
        "notice.dde-field.phrase": "DDE 域（未运行）",
        "notice.dde-field.status": "未运行",
        "notice.embedded-fonts.phrase": "嵌入字体（已改用系统字体）",
        "notice.embedded-fonts.status": "已改用系统字体",
        "noun.text-box.one": "文本框",
        "noun.text-box.other": "文本框",
        "noun.equation.one": "公式",
        "noun.equation.other": "公式",
        "noun.chart.one": "图表",
        "noun.chart.other": "图表",
        "noun.smart-art.one": "SmartArt 图形",
        "noun.smart-art.other": "SmartArt 图形",
        "noun.shape.one": "形状",
        "noun.shape.other": "形状",
        "noun.ole-object.one": "嵌入对象",
        "noun.ole-object.other": "嵌入对象",
        "noun.activex.one": "ActiveX 控件",
        "noun.activex.other": "ActiveX 控件",
        "noun.alt-chunk.one": "导入的内容块",
        "noun.alt-chunk.other": "导入的内容块",
        "noun.tracked-changes.one": "修订",
        "noun.tracked-changes.other": "修订",
        "noun.comments.one": "批注",
        "noun.comments.other": "批注",
        "noun.macros.one": "宏项目",
        "noun.macros.other": "宏项目",
        "noun.remote-template.one": "远程模板",
        "noun.remote-template.other": "远程模板",
        "noun.remote-image.one": "远程图片",
        "noun.remote-image.other": "远程图片",
        "noun.external-content.one": "外部内容链接",
        "noun.external-content.other": "外部内容链接",
        "noun.dde-field.one": "DDE 域",
        "noun.dde-field.other": "DDE 域",
        "noun.embedded-fonts.one": "嵌入字体",
        "noun.embedded-fonts.other": "嵌入字体",
        "kind.legacy-doc.title": "Word 97-2003 文档",
        "kind.legacy-doc.message": "这是 Word 97-2003 文档 (.doc)。LeanDoc 0.1 只能读取 .docx 文件。",
        "kind.encrypted-ooxml.title": "受密码保护的文档",
        "kind.encrypted-ooxml.message": "此文档受密码保护。LeanDoc 不打开受保护的文档。",
        "kind.rtf.title": "Rich Text Format 文档",
        "kind.rtf.message": "这是 Rich Text Format 文档 (.rtf)。LeanDoc 0.1 只能读取 .docx 文件。",
        "kind.odt.title": "OpenDocument 文本",
        "kind.odt.message": "这是 OpenDocument 文本文件 (.odt)。LeanDoc 0.1 只能读取 .docx 文件。",
        "kind.not-a-document.title": "不是 Word 文档",
        "kind.not-a-document.message": "此文件不是 Word 文档。LeanDoc 只能读取 .docx 文件。",
        "fallback.couldNotOpen": "无法打开此文档",
        "fallback.couldNotRead": "LeanDoc 无法读取此文档。",
        "fallback.couldNotShow": "LeanDoc 无法显示此文档。",
        "error.too-large": "此文件超过了 LeanDoc 的 256 MB 上限。",
        "error.not-a-zip": "此文件不是有效的 Word 文档。",
        "error.corrupt-zip": "此文档已损坏，无法读取。",
        "error.too-many-entries": "此文档包含的部件数超出了 LeanDoc 的读取上限。",
        "error.part-too-large": "此文档中有一个部件超出了 LeanDoc 的大小上限。",
        "error.compression-ratio": "此文档解压后远超其文件大小，因此 LeanDoc 已停止读取。",
        "error.unsafe-entry-name": "此文档包含名称不安全的部件，因此 LeanDoc 已停止读取。",
        "error.duplicate-entry": "此文档包含重复的部件，因此 LeanDoc 已停止读取。",
        "error.encrypted-entry": "此文档包含加密的部件。LeanDoc 不打开受保护的文档。",
        "error.missing-main-part": "此文件没有 Word 文档正文。",
        "error.xml-doctype": "此文档包含文档类型声明，LeanDoc 拒绝读取。",
        "error.xml-malformed": "此文档包含格式错误的 XML，无法读取。",
        "error.xml-too-deep": "此文档的嵌套层级超出了 LeanDoc 的读取上限。",
        "error.read-failed": "LeanDoc 无法读取此文件。",
        "error.renderer-stopped": "LeanDoc 的渲染器在显示此文档时多次停止运行。请按 F5 重试。",
        "host.unsupportedType": "LeanDoc 可以打开 .docx、.dotx、.docm、.dotm、.doc、.rtf 和 .odt 文件。",
        "host.tooManyTabs": "LeanDoc 最多保留 64 个标签页。请先关闭一个，再打开其他文档。",
        "host.stillChanging": "文件仍在更改或无法读取。继续显示上一次的完整内容。",
        "host.windowsNoPicker": "Windows 无法打开文件选择器。",
        "host.movedOrDeleted": "文件已被移动或删除。仍显示上一次的完整内容。",
        "host.webAndEmailOnly": "LeanDoc 只打开网页链接和电子邮件链接。",
        "host.windowsNoLink": "Windows 无法打开该链接。",
        "host.wordForTheWeb": "已在浏览器中打开 Word for the web。请将文件上传到那里进行阅读或编辑。",
        "host.noEditor": "LeanDoc 无法启动编辑器。",
        "host.linuxNoBrowser": "Linux 无法打开浏览器。",
        "host.linuxNoLink": "Linux 无法打开该链接。",
        "host.localFilesOnly": "LeanDoc 只能打开本地文件。",
        "host.macNoLink": "macOS 无法打开该链接。",
        "host.macNoBrowser": "macOS 无法打开浏览器。",
        "core.noWordPart": "此文件不包含 Word 文档部件。",
        "core.notWord": "此文件不是 Word 文档。",
        "core.outOfMemory": "LeanDoc 在读取此文件时内存不足。",
        "core.notFound": "LeanDoc 找不到此文件。",
        "core.folder": "该路径是文件夹，不是文档。",
        "core.regularOnly": "LeanDoc 只能读取普通文件。",
        "core.regularFilesOnly": "LeanDoc 只能打开普通文件。",
        "core.noMeasure": "LeanDoc 无法获取此文件的大小。",
        "core.readFailed": "LeanDoc 无法读取此文件。",
        "core.unfinished": "LeanDoc 未能读完此文件。",
        "core.tooLargeWindows": "此文件超过了 LeanDoc 的 256 MiB 安全上限。",
        "core.dtd": "此文档包含 DTD，LeanDoc 拒绝读取。",
        "core.tooDeep": "此文档的 XML 嵌套层级超出了 LeanDoc 的允许范围。",
        "core.unsafeName": "此文档包含名称不安全的部件。",
        "core.sameName": "此文档包含两个同名部件。",
        "core.encryptedPart": "此文档包含一个加密的部件。",
        "core.compression": "此文档使用了 LeanDoc 不支持的压缩方式。",
        "core.overCompressed": "此文档中有一个部件的压缩率超出了 LeanDoc 的允许范围。",
        "native.couldNotStart": "LeanDoc 无法启动",
        "native.needsWebView2": "LeanDoc 需要 Microsoft Edge WebView2 Runtime。请安装或修复 WebView2，然后重试。",
        "native.noReaderSurface": "Windows 无法创建 LeanDoc 的阅读界面。",
        "native.webView2Failed": "LeanDoc 无法初始化 WebView2 Runtime。",
        "native.openTitle": "打开文档",
        "native.wordDocuments": "Word 文档",
        "native.allFiles": "所有文件",
        "native.readOnly": "LeanDoc 是只读查看器，不会保存文档。",
        "native.unsupportedType": "LeanDoc 可以打开 .docx、.dotx、.docm、.dotm、.doc、.rtf 和 .odt 文件。",
        "native.menuAbout": "关于 LeanDoc",
        "native.menuServices": "服务",
        "native.menuHide": "隐藏 LeanDoc",
        "native.menuHideOthers": "隐藏其他",
        "native.menuShowAll": "全部显示",
        "native.menuQuit": "退出 LeanDoc",
        "native.menuFile": "文件",
        "native.menuOpen": "打开…",
        "native.menuClose": "关闭",
        "native.menuEdit": "编辑",
        "native.menuCopy": "拷贝",
        "native.menuSelectAll": "全选",
        "native.menuWindow": "窗口",
        "native.menuMinimize": "最小化",
        "native.menuZoom": "缩放",
        "native.menuBringAllToFront": "前置全部窗口"
      },
      ja: {
        "app.currentDocument": "現在のドキュメント",
        "app.tagline": "Word ドキュメント リーダー",
        "toolbar.label": "リーダーの操作",
        "find.label": "ドキュメント内を検索",
        "find.placeholder": "検索",
        "find.title": "ドキュメント内を検索 (Ctrl+F, F3)",
        "view.label": "表示",
        "view.page": "ページ",
        "view.pageTitle": "ページ表示 (Ctrl+Shift+V)",
        "view.reading": "閲覧",
        "view.readingTitle": "閲覧モード (Ctrl+Shift+V)",
        "zoom.label": "ズーム",
        "zoom.out": "縮小",
        "zoom.outTitle": "縮小 (Ctrl+-)",
        "zoom.in": "拡大",
        "zoom.inTitle": "拡大 (Ctrl++)",
        "zoom.valueTitle": "幅に合わせる、または 100% (Ctrl+0)",
        "zoom.valueLabelAuto": "ズーム {percent}。押すと幅に合わせます。",
        "zoom.valueLabelFit": "ズーム {percent}、幅に合わせて表示中。押すと 100% にします。",
        "zoom.autoTitle": "押すと幅に合わせます (Ctrl+0 でリセット)",
        "zoom.fitTitle": "幅に合わせて表示中。押すと 100% にします (Ctrl+0 でリセット)",
        "theme.system": "システム",
        "theme.light": "ライト",
        "theme.dark": "ダーク",
        "theme.dim": "薄暗い",
        "theme.dusk": "夕暮れ",
        "theme.systemShown": "システム ({theme})",
        "theme.buttonLabel": "テーマ：{name}。押すとテーマを切り替えます。",
        "theme.buttonTitle": "テーマ：{name} (Ctrl+Shift+T)",
        "settings.buttonLabel": "設定とキーボード ショートカット",
        "settings.buttonTitle": "設定とショートカット (Ctrl+/)",
        "open.button": "開く",
        "open.title": "ドキュメントを開く (Ctrl+O)",
        "tabs.label": "開いているドキュメント",
        "tabs.closeTitle": "閉じる (Ctrl+W)",
        "fidelity.label": "表示に関する注意",
        "fidelity.details": "詳細",
        "fidelity.hideDetails": "詳細を非表示",
        "fidelity.collapse": "折りたたむ",
        "fidelity.expand": "展開する",
        "fidelity.collapseLabel": "表示に関する注意を折りたたむ",
        "fidelity.expandLabel": "表示に関する注意を展開する",
        "outline.label": "ドキュメントのアウトライン",
        "outline.title": "アウトライン",
        "outline.hide": "アウトラインを非表示",
        "outline.show": "アウトラインを表示",
        "outline.untitled": "無題のセクション",
        "document.label": "ドキュメント",
        "empty.title": "オフィス ソフトを起動せずに Word ドキュメントを読めます。",
        "empty.message": ".docx ファイルを開くと、ここで読めます。LeanDoc はマクロを実行せず、ドキュメントが参照する外部の内容も取得しません。",
        "empty.openButton": "ドキュメントを開く",
        "fallback.openButton": "別のドキュメントを開く",
        "recent.title": "最近のファイル",
        "recent.clear": "履歴をクリア",
        "recent.itemLabel": "{name} を開く、{path}",
        "settings.title": "設定",
        "settings.close": "設定を閉じる",
        "settings.closeTitle": "閉じる (Esc)",
        "settings.theme": "テーマ",
        "settings.view": "表示",
        "settings.pageColor": "ページの色",
        "settings.paper": "白（紙のように）",
        "settings.themeColours": "テーマの色",
        "settings.fitWidth": "幅に合わせる",
        "settings.reset": "リセット",
        "settings.shortcuts": "キーボード ショートカット",
        "settings.language": "言語",
        "settings.languageSystem": "システム",
        "identity.untitled": "無題",
        "identity.notShown": "表示できません",
        "identity.opening": "開いています",
        "identity.onePage": "1 ページ",
        "identity.pages": "{count} ページ",
        "identity.readingView": "閲覧モード",
        "fallback.notShownTitle": "このドキュメントを表示できませんでした",
        "fallback.layoutFailed": "LeanDoc はこのドキュメントをレイアウトできませんでした。",
        "link.blocked": "LeanDoc が開けるのはウェブとメールのリンクだけです。",
        "copy.done": "ドキュメントをテキストとしてコピーしました。",
        "copy.failed": "LeanDoc はクリップボードにコピーできませんでした。",
        "status.rendererMissing": "LeanDoc はドキュメント レンダラーを読み込めませんでした。",
        "editor.openIn": "{name} で開く",
        "editor.openDefault": "既定のアプリで開く",
        "editor.openWeb": "Word for the web を開く",
        "editor.title": "{label} (Ctrl+Shift+E)",
        "group.reader": "リーダー",
        "group.settings": "設定パネル",
        "group.tabs": "タブ",
        "group.find": "検索ボックス",
        "group.tabStrip": "タブ バー",
        "group.menu": "メニュー",
        "shortcut.open": "ドキュメントを開く",
        "shortcut.find": "ドキュメント内を検索",
        "shortcut.nextMatch": "次の一致",
        "shortcut.previousMatch": "前の一致",
        "shortcut.reload": "ディスクから再読み込み",
        "shortcut.switchView": "ページ表示と閲覧モードを切り替える",
        "shortcut.theme": "テーマを切り替える",
        "shortcut.editor": "エディターで開く",
        "shortcut.copy": "すべてのテキストをコピー",
        "shortcut.zoomIn": "拡大",
        "shortcut.zoomOut": "縮小",
        "shortcut.zoomReset": "ズームをリセット",
        "shortcut.settings": "設定とショートカット",
        "shortcut.closePanel": "設定パネルを閉じる",
        "shortcut.nextTab": "次のタブ",
        "shortcut.previousTab": "前のタブ",
        "shortcut.closeTab": "タブを閉じる",
        "shortcut.tabByPosition": "指定した位置のタブへ移動",
        "shortcut.lastTab": "最後のタブへ移動",
        "shortcut.clearSearch": "検索をクリア",
        "shortcut.firstTab": "最初のタブ",
        "shortcut.lastTabStrip": "最後のタブ",
        "shortcut.closeWindow": "ウィンドウを閉じる",
        "shortcut.minimize": "ウィンドウをしまう",
        "shortcut.hide": "LeanDoc を隠す",
        "shortcut.quit": "LeanDoc を終了",
        "key.tabRange": "Ctrl+1 から Ctrl+8",
        "key.rightArrow": "右矢印キー",
        "key.leftArrow": "左矢印キー",
        "list.pair": "と",
        "list.separator": "、",
        "list.last": "、",
        "fidelity.count": "{noun} {count} 件",
        "fidelity.hiddenSentence": "このドキュメントには、LeanDoc で表示されない{list}が含まれています。",
        "fidelity.alsoSentence": "また、{list}も含まれています。",
        "fidelity.containsSentence": "このドキュメントには{list}が含まれています。",
        "fidelity.summaryHidden": "このドキュメントの一部の内容は表示されていません。",
        "fidelity.summaryNotice": "このドキュメントには注意事項があります。",
        "fidelity.summaryNotices": "このドキュメントには複数の注意事項があります。",
        "fidelity.statusNotDisplayed": "表示されません",
        "fidelity.statusNoted": "注記あり",
        "notice.tracked-changes.phrase": "変更履歴（承諾した状態で表示）",
        "notice.tracked-changes.status": "承諾した状態で表示",
        "notice.comments.phrase": "コメント（非表示）",
        "notice.comments.status": "非表示",
        "notice.macros.phrase": "マクロ（実行しません）",
        "notice.macros.status": "実行しません",
        "notice.remote-template.phrase": "リモートのテンプレート（取得しません）",
        "notice.remote-template.status": "取得しません",
        "notice.remote-image.phrase": "リモートの画像（取得しません）",
        "notice.remote-image.status": "取得しません",
        "notice.external-content.phrase": "外部コンテンツ（取得しません）",
        "notice.external-content.status": "取得しません",
        "notice.dde-field.phrase": "DDE フィールド（実行しません）",
        "notice.dde-field.status": "実行しません",
        "notice.embedded-fonts.phrase": "埋め込みフォント（システム フォントを使用）",
        "notice.embedded-fonts.status": "システム フォントを使用",
        "noun.text-box.one": "テキスト ボックス",
        "noun.text-box.other": "テキスト ボックス",
        "noun.equation.one": "数式",
        "noun.equation.other": "数式",
        "noun.chart.one": "グラフ",
        "noun.chart.other": "グラフ",
        "noun.smart-art.one": "SmartArt グラフィック",
        "noun.smart-art.other": "SmartArt グラフィック",
        "noun.shape.one": "図形",
        "noun.shape.other": "図形",
        "noun.ole-object.one": "埋め込みオブジェクト",
        "noun.ole-object.other": "埋め込みオブジェクト",
        "noun.activex.one": "ActiveX コントロール",
        "noun.activex.other": "ActiveX コントロール",
        "noun.alt-chunk.one": "インポートされたコンテンツ ブロック",
        "noun.alt-chunk.other": "インポートされたコンテンツ ブロック",
        "noun.tracked-changes.one": "変更箇所",
        "noun.tracked-changes.other": "変更箇所",
        "noun.comments.one": "コメント",
        "noun.comments.other": "コメント",
        "noun.macros.one": "マクロ プロジェクト",
        "noun.macros.other": "マクロ プロジェクト",
        "noun.remote-template.one": "リモートのテンプレート",
        "noun.remote-template.other": "リモートのテンプレート",
        "noun.remote-image.one": "リモートの画像",
        "noun.remote-image.other": "リモートの画像",
        "noun.external-content.one": "外部コンテンツへのリンク",
        "noun.external-content.other": "外部コンテンツへのリンク",
        "noun.dde-field.one": "DDE フィールド",
        "noun.dde-field.other": "DDE フィールド",
        "noun.embedded-fonts.one": "埋め込みフォント",
        "noun.embedded-fonts.other": "埋め込みフォント",
        "kind.legacy-doc.title": "Word 97-2003 ドキュメント",
        "kind.legacy-doc.message": "これは Word 97-2003 ドキュメント (.doc) です。LeanDoc 0.1 が読み取れるのは .docx ファイルだけです。",
        "kind.encrypted-ooxml.title": "パスワードで保護されたドキュメント",
        "kind.encrypted-ooxml.message": "このドキュメントはパスワードで保護されています。LeanDoc は保護されたドキュメントを開きません。",
        "kind.rtf.title": "Rich Text Format ドキュメント",
        "kind.rtf.message": "これは Rich Text Format ドキュメント (.rtf) です。LeanDoc 0.1 が読み取れるのは .docx ファイルだけです。",
        "kind.odt.title": "OpenDocument テキスト",
        "kind.odt.message": "これは OpenDocument テキスト ファイル (.odt) です。LeanDoc 0.1 が読み取れるのは .docx ファイルだけです。",
        "kind.not-a-document.title": "Word ドキュメントではありません",
        "kind.not-a-document.message": "このファイルは Word ドキュメントではありません。LeanDoc が読み取れるのは .docx ファイルだけです。",
        "fallback.couldNotOpen": "このドキュメントを開けませんでした",
        "fallback.couldNotRead": "LeanDoc はこのドキュメントを読み取れませんでした。",
        "fallback.couldNotShow": "LeanDoc はこのドキュメントを表示できませんでした。",
        "error.too-large": "このファイルは LeanDoc の上限 256 MB を超えています。",
        "error.not-a-zip": "このファイルは有効な Word ドキュメントではありません。",
        "error.corrupt-zip": "このドキュメントは破損しているため、読み取れません。",
        "error.too-many-entries": "このドキュメントのパーツ数は、LeanDoc が読み取れる上限を超えています。",
        "error.part-too-large": "このドキュメントのパーツの 1 つが、LeanDoc の上限を超える大きさです。",
        "error.compression-ratio": "このドキュメントは展開するとファイル サイズをはるかに超えるため、LeanDoc は読み取りを中止しました。",
        "error.unsafe-entry-name": "このドキュメントには安全でない名前のパーツが含まれているため、LeanDoc は読み取りを中止しました。",
        "error.duplicate-entry": "このドキュメントには重複したパーツが含まれているため、LeanDoc は読み取りを中止しました。",
        "error.encrypted-entry": "このドキュメントには暗号化されたパーツが含まれています。LeanDoc は保護されたドキュメントを開きません。",
        "error.missing-main-part": "このファイルには Word ドキュメントの本文がありません。",
        "error.xml-doctype": "このドキュメントにはドキュメント型宣言が含まれているため、LeanDoc は読み取りを拒否します。",
        "error.xml-malformed": "このドキュメントには不正な形式の XML が含まれているため、読み取れません。",
        "error.xml-too-deep": "このドキュメントの入れ子の深さは、LeanDoc が読み取れる上限を超えています。",
        "error.read-failed": "LeanDoc はこのファイルを読み取れませんでした。",
        "error.renderer-stopped": "このドキュメントの表示中に LeanDoc のレンダラーが何度も停止しました。F5 キーを押して、もう一度お試しください。",
        "host.unsupportedType": "LeanDoc で開けるのは .docx、.dotx、.docm、.dotm、.doc、.rtf、.odt ファイルです。",
        "host.tooManyTabs": "LeanDoc で開けるタブは 64 個までです。さらに開くには、タブを 1 つ閉じてください。",
        "host.stillChanging": "ファイルが変更中か、読み取れません。最後に読み込んだ内容をそのまま表示します。",
        "host.windowsNoPicker": "Windows はファイルを選択する画面を開けませんでした。",
        "host.movedOrDeleted": "ファイルが移動または削除されました。最後に読み込んだ内容を引き続き表示しています。",
        "host.webAndEmailOnly": "LeanDoc が開くのはウェブとメールのリンクだけです。",
        "host.windowsNoLink": "Windows はそのリンクを開けませんでした。",
        "host.wordForTheWeb": "Word for the web をブラウザーで開きました。閲覧または編集するには、そこにファイルをアップロードしてください。",
        "host.noEditor": "LeanDoc はエディターを起動できませんでした。",
        "host.linuxNoBrowser": "Linux はブラウザーを開けませんでした。",
        "host.linuxNoLink": "Linux はそのリンクを開けませんでした。",
        "host.localFilesOnly": "LeanDoc で開けるのはローカル ファイルだけです。",
        "host.macNoLink": "macOS はそのリンクを開けませんでした。",
        "host.macNoBrowser": "macOS はブラウザーを開けませんでした。",
        "core.noWordPart": "このファイルには Word ドキュメントのパーツが含まれていません。",
        "core.notWord": "このファイルは Word ドキュメントではありません。",
        "core.outOfMemory": "このファイルの読み取り中に LeanDoc のメモリが不足しました。",
        "core.notFound": "LeanDoc はこのファイルを見つけられませんでした。",
        "core.folder": "そのパスはフォルダーで、ドキュメントではありません。",
        "core.regularOnly": "LeanDoc が読み取れるのは通常のファイルだけです。",
        "core.regularFilesOnly": "LeanDoc で開けるのは通常のファイルだけです。",
        "core.noMeasure": "LeanDoc はこのファイルのサイズを取得できませんでした。",
        "core.readFailed": "LeanDoc はこのファイルを読み取れませんでした。",
        "core.unfinished": "LeanDoc はこのファイルを最後まで読み取れませんでした。",
        "core.tooLargeWindows": "このファイルは LeanDoc の安全上限 256 MiB を超えています。",
        "core.dtd": "このドキュメントには DTD が含まれているため、LeanDoc は読み取りを拒否します。",
        "core.tooDeep": "このドキュメントの XML の入れ子の深さが、LeanDoc の上限を超えています。",
        "core.unsafeName": "このドキュメントには安全でない名前のパーツが含まれています。",
        "core.sameName": "このドキュメントには同じ名前のパーツが 2 つ含まれています。",
        "core.encryptedPart": "このドキュメントには暗号化されたパーツが含まれています。",
        "core.compression": "このドキュメントは、LeanDoc が対応していない圧縮方式を使用しています。",
        "core.overCompressed": "このドキュメントのパーツの 1 つが、LeanDoc の許容を超えて圧縮されています。",
        "native.couldNotStart": "LeanDoc を起動できませんでした",
        "native.needsWebView2": "LeanDoc には Microsoft Edge WebView2 ランタイムが必要です。WebView2 をインストールまたは修復してから、もう一度お試しください。",
        "native.noReaderSurface": "Windows は LeanDoc の表示領域を作成できませんでした。",
        "native.webView2Failed": "LeanDoc は WebView2 ランタイムを初期化できませんでした。",
        "native.openTitle": "ドキュメントを開く",
        "native.wordDocuments": "Word ドキュメント",
        "native.allFiles": "すべてのファイル",
        "native.readOnly": "LeanDoc は読み取り専用のビューアーで、ドキュメントを保存しません。",
        "native.unsupportedType": "LeanDoc で開けるのは .docx、.dotx、.docm、.dotm、.doc、.rtf、.odt ファイルです。",
        "native.menuAbout": "LeanDoc について",
        "native.menuServices": "サービス",
        "native.menuHide": "LeanDoc を非表示",
        "native.menuHideOthers": "ほかを非表示",
        "native.menuShowAll": "すべてを表示",
        "native.menuQuit": "LeanDoc を終了",
        "native.menuFile": "ファイル",
        "native.menuOpen": "開く…",
        "native.menuClose": "閉じる",
        "native.menuEdit": "編集",
        "native.menuCopy": "コピー",
        "native.menuSelectAll": "すべてを選択",
        "native.menuWindow": "ウィンドウ",
        "native.menuMinimize": "しまう",
        "native.menuZoom": "拡大/縮小",
        "native.menuBringAllToFront": "すべてを手前に移動"
      }
    };

    var languages = ["en", "zh-CN", "ja"];
    var has = Object.prototype.hasOwnProperty;

    // A saved or requested setting, ignoring ASCII case as the hosts do.
    // Anything else follows the system.
    function normalizeSetting(setting) {
      var lower = String(setting || "").toLowerCase();
      for (var index = 0; index < languages.length; index += 1) {
        if (languages[index].toLowerCase() === lower) {
          return languages[index];
        }
      }
      return "system";
    }

    // LeanMark's rule, and SystemInterfaceLanguage in
    // src/core/ReaderSettings.h: ja tags pick Japanese, Simplified Chinese
    // tags (zh, zh-CN, zh-SG, zh-Hans-*) pick Chinese, and Traditional
    // Chinese (zh-TW, zh-HK, zh-MO, zh-Hant-*) and anything else keep
    // English. POSIX forms such as zh_CN.UTF-8 count too.
    function systemLanguage(tag) {
      var lower = String(tag || "").split(/[.@]/)[0].replace(/_/g, "-").toLowerCase();
      if (lower === "ja" || lower.indexOf("ja-") === 0) {
        return "ja";
      }
      if (lower !== "zh" && lower.indexOf("zh-") !== 0) {
        return "en";
      }
      var rest = "-" + lower.slice(2) + "-";
      if (rest.indexOf("-hant-") >= 0) {
        return "en";
      }
      if (rest.indexOf("-hans-") >= 0) {
        return "zh-CN";
      }
      if (/-(tw|hk|mo)-/.test(rest)) {
        return "en";
      }
      return "zh-CN";
    }

    function resolve(setting, systemTag) {
      var chosen = normalizeSetting(setting);
      return chosen === "system" ? systemLanguage(systemTag) : chosen;
    }

    function hasKey(key) {
      return has.call(tables.en, key);
    }

    function text(language, key, values) {
      var table = has.call(tables, language) ? tables[language] : tables.en;
      var value = has.call(table, key) ? table[key] : hasKey(key) ? tables.en[key] : key;
      return values
        ? value.replace(/\{([a-zA-Z]+)\}/g, function (whole, name) {
          return has.call(values, name) ? String(values[name]) : whole;
        })
        : value;
    }

    // The key of a message the hosts or the core send in English.
    var messageKeys = null;
    function messageKey(message) {
      if (!messageKeys) {
        messageKeys = {};
        Object.keys(tables.en).forEach(function (key) {
          if (/^(host|core|error)\./.test(key) && !has.call(messageKeys, tables.en[key])) {
            messageKeys[tables.en[key]] = key;
          }
        });
      }
      return has.call(messageKeys, message) ? messageKeys[message] : "";
    }

    // A message a host sent in English, in the interface language. One no
    // table knows (from a newer host, say) is shown as it came.
    function hostText(language, message) {
      message = String(message || "");
      var key = language === "en" ? "" : messageKey(message);
      return key ? text(language, key) : message;
    }

    return {
      languages: languages,
      tables: tables,
      normalizeSetting: normalizeSetting,
      systemLanguage: systemLanguage,
      resolve: resolve,
      hasKey: hasKey,
      text: text,
      messageKey: messageKey,
      hostText: hostText
    };
  }());
  // END interface strings

  var t = interfaceStrings.text;

  // Notices are named, not counted, and say what LeanDoc did with them (the
  // notice.<code> strings).
  var NOTICES = {
    "tracked-changes": true,
    "comments": true,
    "macros": true,
    "remote-template": true,
    "remote-image": true,
    "external-content": true,
    "dde-field": true,
    "embedded-fonts": true
  };

  // The noun.<code> strings, used when a report arrives without its own nouns
  // and in every language but English, where the core's English nouns would
  // not fit.
  var NOUN_CODES = {
    "smartart": "smart-art"
  };

  function language(name) {
    return interfaceStrings.languages.indexOf(name) >= 0 ? name : "en";
  }

  // "A and B", "A, B, and C", with each language's joiners.
  function joinList(items, inLanguage) {
    var shown = language(inLanguage);
    if (items.length <= 1) {
      return items.join("");
    }
    if (items.length === 2) {
      return items[0] + t(shown, "list.pair") + items[1];
    }
    return items.slice(0, -1).join(t(shown, "list.separator")) + t(shown, "list.last") +
      items[items.length - 1];
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function nounFor(feature, count, shown) {
    var code = NOUN_CODES[feature.code] || feature.code;
    var key = "noun." + code + (count === 1 ? ".one" : ".other");
    var known = interfaceStrings.hasKey(key);
    if (shown === "en" || !known) {
      var fallback = known ? t("en", key) : feature.code;
      var own = count === 1 ? feature.singular : feature.plural;
      return own || fallback;
    }
    return t(shown, key);
  }

  function normalizeFeatures(report) {
    var list = report && Array.isArray(report.features) ? report.features : [];
    return list.filter(function (feature) {
      return feature && typeof feature.code === "string" &&
        Number(feature.count) > 0;
    }).map(function (feature) {
      return {
        code: feature.code,
        count: Math.floor(Number(feature.count)),
        notDisplayed: feature.notDisplayed === true,
        singular: typeof feature.singular === "string" ? feature.singular : "",
        plural: typeof feature.plural === "string" ? feature.plural : ""
      };
    });
  }

  // Returns null when the report lists no features: no bar is shown. Written
  // in the interface language (English when none is given).
  function describeFidelity(report, inLanguage) {
    var shown = language(inLanguage);
    var features = normalizeFeatures(report);
    if (!features.length) {
      return null;
    }
    var hidden = features.filter(function (feature) {
      return feature.notDisplayed;
    });
    var notices = features.filter(function (feature) {
      return !feature.notDisplayed;
    });
    var sentences = [];
    if (hidden.length) {
      sentences.push(t(shown, "fidelity.hiddenSentence", {
        list: joinList(hidden.map(function (feature) {
          return t(shown, "fidelity.count", {
            count: feature.count,
            noun: nounFor(feature, feature.count, shown)
          });
        }), shown)
      }));
    }
    if (notices.length) {
      var phrases = notices.map(function (feature) {
        return NOTICES[feature.code]
          ? t(shown, "notice." + feature.code + ".phrase")
          : nounFor(feature, 2, shown);
      });
      sentences.push(t(shown, hidden.length ? "fidelity.alsoSentence" : "fidelity.containsSentence",
        { list: joinList(phrases, shown) }));
    }
    var items = features.map(function (feature) {
      return {
        code: feature.code,
        count: feature.count,
        label: capitalize(nounFor(feature, feature.count, shown)),
        status: feature.notDisplayed
          ? t(shown, "fidelity.statusNotDisplayed")
          : NOTICES[feature.code]
            ? t(shown, "notice." + feature.code + ".status")
            : t(shown, "fidelity.statusNoted")
      };
    });
    var summary = hidden.length
      ? t(shown, "fidelity.summaryHidden")
      : t(shown, notices.length === 1 ? "fidelity.summaryNotice" : "fidelity.summaryNotices");
    return {
      sentences: sentences,
      // Chinese and Japanese sentences follow one another without a space.
      text: sentences.join(shown === "en" ? " " : ""),
      summary: summary,
      hasHidden: hidden.length > 0,
      items: items
    };
  }

  var KINDS = ["legacy-doc", "encrypted-ooxml", "rtf", "odt", "not-a-document"];

  // A sentence from the core or a host's reader in the interface language: a
  // known sentence by its English, then the sentence for its error code (a
  // sentence with a number in it, such as a limit, has no exact match), and
  // otherwise as it came.
  function reportSentence(message, code, shown) {
    if (shown === "en") {
      return message;
    }
    var key = interfaceStrings.messageKey(message);
    if (key) {
      return t(shown, key);
    }
    return interfaceStrings.hasKey("error." + code) ? t(shown, "error." + code) : message;
  }

  // A fallback page: a short title and one sentence on what the file is and
  // why it is not shown. Core errors prefer the core's own sentence.
  function describeFallback(report, inLanguage) {
    var shown = language(inLanguage);
    var kind = report && typeof report.kind === "string" ? report.kind : "";
    var errorCode = report && typeof report.errorCode === "string" ? report.errorCode : "";
    var errorMessage = report && typeof report.errorMessage === "string"
      ? report.errorMessage.trim()
      : "";
    var known = KINDS.indexOf(kind) >= 0;
    if (known && !errorCode) {
      return { title: t(shown, "kind." + kind + ".title"), message: t(shown, "kind." + kind + ".message"), code: kind };
    }
    if (errorCode || (report && report.ok === false)) {
      var message = errorMessage
        ? reportSentence(errorMessage, errorCode, shown)
        : interfaceStrings.hasKey("error." + errorCode)
          ? t(shown, "error." + errorCode)
          : t(shown, "fallback.couldNotRead");
      return {
        title: t(shown, "fallback.couldNotOpen"),
        message: message,
        code: errorCode || "error"
      };
    }
    if (known) {
      return { title: t(shown, "kind." + kind + ".title"), message: t(shown, "kind." + kind + ".message"), code: kind };
    }
    return {
      title: t(shown, "fallback.notShownTitle"),
      message: errorMessage ? reportSentence(errorMessage, "", shown) : t(shown, "fallback.couldNotShow"),
      code: kind || "unknown"
    };
  }

  // The editor button. Windows names the editor ("Word"); Linux and macOS
  // send a whole label ("Open in Pages", "Open with default app"), which is
  // read back here so it can be shown in the interface language.
  function editorActionLabel(label, inLanguage) {
    var shown = language(inLanguage);
    var text = typeof label === "string" ? label.trim() : "";
    if (!text) {
      return "";
    }
    if (!/^open\b/i.test(text)) {
      return t(shown, "editor.openIn", { name: text });
    }
    if (shown === "en") {
      return text;
    }
    if (text === t("en", "editor.openDefault")) {
      return t(shown, "editor.openDefault");
    }
    if (text === t("en", "editor.openWeb")) {
      return t(shown, "editor.openWeb");
    }
    var named = /^Open in (.+)$/.exec(text);
    return named ? t(shown, "editor.openIn", { name: named[1] }) : text;
  }

  return Object.freeze({
    joinList: joinList,
    describeFidelity: describeFidelity,
    describeFallback: describeFallback,
    editorActionLabel: editorActionLabel,
    strings: interfaceStrings,
    NOTICES: NOTICES
  });
}));
