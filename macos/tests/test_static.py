#!/usr/bin/env python3
"""Static checks of the macOS host and its packaging, with no dependencies."""

from __future__ import annotations

import plistlib
import sys
from pathlib import Path


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def contains_all(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    require(not missing, f"{label} is missing: {', '.join(missing)}")


EXTENSIONS = {"docx", "dotx", "docm", "dotm", "doc", "rtf", "odt"}


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: test_static.py <repository-root>", file=sys.stderr)
        return 2

    root = Path(sys.argv[1]).resolve()
    mac = root / "macos"
    sources = mac / "src"
    required = [
        mac / "CMakeLists.txt",
        mac / "Info.plist.in",
        mac / "scripts" / "package-macos.sh",
        sources / "main.mm",
        sources / "LDAppDelegate.mm",
        sources / "LDDocument.mm",
        sources / "LDDocumentController.mm",
        sources / "LDDocumentWindowController.mm",
        sources / "LDEditor.mm",
        sources / "LDSchemeHandler.mm",
        sources / "LDTiming.mm",
        root / "src" / "core" / "DocCore.h",
        root / "scripts" / "stage-runtime-assets.mjs",
    ]
    missing = [str(path.relative_to(root)) for path in required if not path.is_file()]
    require(not missing, f"required files are missing: {', '.join(missing)}")

    plist = plistlib.loads((mac / "Info.plist.in").read_bytes())
    require(plist["CFBundlePackageType"] == "APPL", "the bundle must be an app")
    require(plist["CFBundleShortVersionString"] == "@PROJECT_VERSION@",
            "the bundle version must come from package.json through CMake")
    require(plist["LSMinimumSystemVersion"] == "@CMAKE_OSX_DEPLOYMENT_TARGET@",
            "the deployment target must come from CMake")
    documents = plist["CFBundleDocumentTypes"]
    require(len(documents) == 1, "exactly one document type is expected")
    document = documents[0]
    require(document["CFBundleTypeRole"] == "Viewer", "LeanDoc registers as a viewer only")
    require(document["LSHandlerRank"] == "Alternate",
            "LeanDoc must not make itself the default handler")
    require(set(document["CFBundleTypeExtensions"]) == EXTENSIONS,
            "document extensions drifted from the seven SPEC extensions")
    require(document["NSDocumentClass"] == "LDDocument", "documents must open as LDDocument")

    scheme = (sources / "LDSchemeHandler.mm").read_text("utf-8")
    contains_all(scheme, [
        "RelativePath(URL)",
        "isEqualToString:@\"pkg\"",
        "document.docx",
        "URLByResolvingSymlinksInPath",
        "leandoc::core::IsPathWithin",
        "NSURLIsRegularFileKey",
        "kMaximumAssetBytes",
        "\"Cache-Control\" : @\"no-store\"",
        "\"X-Content-Type-Options\" : @\"nosniff\"",
        "Response(URL, 404",
    ], "leandoc: scheme handler")
    require("allowingReadAccessToURL" not in scheme,
            "no folder may be exposed through file URL access")

    window = (sources / "LDDocumentWindowController.mm").read_text("utf-8")
    contains_all(window, [
        "WKWebsiteDataStore.nonPersistentDataStore",
        "setURLSchemeHandler:_schemeHandler forURLScheme:@\"leandoc\"",
        "addScriptMessageHandler:_messageProxy name:@\"leandoc\"",
        "message.frameInfo.isMainFrame",
        "IsAppURL(message.frameInfo.request.URL)",
        "new CustomEvent('leandoc-message'",
        "WKNavigationActionPolicyCancel",
        "WKNavigationResponsePolicyCancel",
        "WKPermissionDecisionDeny",
        "completionHandler(nil)",
        "LeanDoc opens web and email links only.",
        "securitypolicyviolation",
        "generation.unsignedIntegerValue != document.generation",
        "LDTraceTiming(@\"webview-ready\"",
        "LDTraceTiming(@\"rendered\"",
        "LDTraceTiming(@\"package-served\"",
        "LDTraceTiming(@\"window-visible\"",
    ], "WKWebView host")

    document_source = (sources / "LDDocument.mm").read_text("utf-8")
    contains_all(document_source, [
        "leandoc::core::OpenDocumentFile",
        "leandoc::core::IsSupportedDocumentPath",
        "leandoc::core::ReportToJson",
        "leandoc://app/pkg/%lu/%lu/document.docx",
        "kMaximumRecent = 10",
        "LDTraceTiming(@\"document-requested\"",
        "last complete view is still shown",
    ], "document host")

    editor = (sources / "LDEditor.mm").read_text("utf-8")
    order = ["com.microsoft.Word", "org.libreoffice.script", "com.apple.iWork.Pages"]
    positions = [editor.find(identifier) for identifier in order]
    require(all(position >= 0 for position in positions) and positions == sorted(positions),
            "editor order must be Word, LibreOffice, then Pages")
    contains_all(editor, [
        "URLForApplicationToOpenContentType",
        "IsSelf(",
        "https://www.office.com/launch/word",
        "Upload the file there",
        "openURLs:@[ fileURL ]",
    ], "open-in-editor")

    delegate = (sources / "LDAppDelegate.mm").read_text("utf-8")
    contains_all(delegate, [
        "--smoke-test",
        "--exit-after-render=",
        "LDParseExitAfterRender",
        "LeanDoc macOS smoke: %s: %s",
    ], "application delegate")
    main_source = (sources / "main.mm").read_text("utf-8")
    contains_all(main_source, ["--trace-timing", "LDTraceTiming(@\"process-start\""], "main")

    cmake = (mac / "CMakeLists.txt").read_text("utf-8")
    contains_all(cmake, [
        'set(LEANDOC_BUNDLE_IDENTIFIER "io.github.abooodbah.LeanDoc"',
        "XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED \"NO\"",
        "XCODE_ATTRIBUTE_ENABLE_HARDENED_RUNTIME \"YES\"",
        "Resources/assets",
        "leandoc-macos-host",
        "leandoc-macos-test-hooks",
        "package_macos",
    ], "macOS CMake target")

    package = (mac / "scripts" / "package-macos.sh").read_text("utf-8")
    contains_all(package, [
        "codesign --force --sign - --options runtime --timestamp=none",
        '"status": "not-attempted"',
        '"developerID": false',
        '"trustedPublisher": false',
        '"publicDistributionReady": false',
        '"releaseChannel": "preview"',
        'package_name="LeanDoc-v${version}-macos-universal-preview"',
        "lipo -archs",
        "shasum -a 256",
    ], "package trust metadata")
    require("notarytool" not in package and "stapler staple" not in package,
            "credential-free packaging must not imply notarization")

    print("LeanDoc macOS static checks: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"LeanDoc macOS static checks: FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
