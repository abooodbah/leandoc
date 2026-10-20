#include "App.h"

#include "Editor.h"
#include "Platform.h"
#include "core/DocCore.h"
#include "leandoc-version.h"
#include "resource.h"

#include <WebView2EnvironmentOptions.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <shobjidl.h>

#include <algorithm>
#include <climits>
#include <cwctype>
#include <filesystem>
#include <iterator>
#include <utility>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Make;

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")

namespace leandoc::windows_host {
namespace {

constexpr wchar_t kAppHost[] = L"app.leandoc.invalid";
constexpr wchar_t kAppOrigin[] = L"https://app.leandoc.invalid/";
constexpr wchar_t kReaderUrl[] = L"https://app.leandoc.invalid/reader.html";
// The whole app origin is answered by the host through WebResourceRequested:
// reader assets from the assets directory and each tab's sanitized package
// from memory under /pkg/. A WebView2 folder mapping cannot be used for the
// assets, because a mapped host answers every path from disk and a missing
// file (such as /pkg/...) fails before WebResourceRequested is consulted.
constexpr wchar_t kAppFilter[] = L"https://app.leandoc.invalid/*";
constexpr char kAppOriginUtf8[] = "https://app.leandoc.invalid/";
constexpr char kPackagePrefix[] = "https://app.leandoc.invalid/pkg/";
constexpr ULONGLONG kMaximumAssetBytes = 64ull * 1024ull * 1024ull;
constexpr wchar_t kSettingsKey[] = L"Software\\LeanDoc";
constexpr wchar_t kDocxContentType[] =
    L"application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// LeanMark's measured choices, kept until the owner re-measures them for
// LeanDoc (docs/architecture/hosts.md). A static document needs no GPU
// rasterization; on WebView2 153 the GPU process cost about 55 MiB private.
// The network service runs in the browser process: the reader's CSP leaves it
// only LeanDoc's own origin. LEANDOC_BROWSER_PROFILE=gpu keeps the GPU on so
// tests/owner/Measure-Performance.ps1 can compare both.
constexpr wchar_t kBrowserArguments[] =
    L"--disable-background-networking --disable-component-update "
    L"--disable-sync --no-first-run --disk-cache-size=1048576 "
    L"--media-cache-size=1048576 --disable-gpu --disable-software-rasterizer "
    L"--enable-features=NetworkServiceInProcess2";
constexpr wchar_t kBrowserArgumentsWithGpu[] =
    L"--disable-background-networking --disable-component-update "
    L"--disable-sync --no-first-run --disk-cache-size=1048576 "
    L"--media-cache-size=1048576 --enable-features=NetworkServiceInProcess2";

bool StartsWithInsensitive(std::wstring_view value, std::wstring_view prefix) {
    if (value.size() < prefix.size()) {
        return false;
    }
    for (std::size_t index = 0; index < prefix.size(); ++index) {
        if (std::towlower(value[index]) != std::towlower(prefix[index])) {
            return false;
        }
    }
    return true;
}

bool SamePath(const std::wstring& left, const std::wstring& right) {
    return CompareStringOrdinal(
               left.c_str(), static_cast<int>(left.size()),
               right.c_str(), static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}

std::wstring EnvironmentValue(const wchar_t* name) {
    const DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
    if (required == 0) {
        return {};
    }
    std::wstring value(required, L'\0');
    const DWORD written = GetEnvironmentVariableW(name, value.data(), required);
    value.resize(written < required ? written : 0);
    return value;
}

bool SystemUsesDarkApps() {
    DWORD lightTheme = 1;
    DWORD size = sizeof(lightTheme);
    const LSTATUS status = RegGetValueW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &lightTheme, &size);
    return status == ERROR_SUCCESS && lightTheme == 0;
}

void AppendJson(std::string& json, std::wstring_view value) {
    core::AppendJsonString(json, WideToUtf8(value));
}

bool ParseDecimal(std::string_view text, unsigned& value) {
    if (text.empty() || text.size() > 9 || text.front() == '0') {
        return false;
    }
    unsigned parsed = 0;
    for (const char digit : text) {
        if (digit < '0' || digit > '9') {
            return false;
        }
        parsed = parsed * 10 + static_cast<unsigned>(digit - '0');
    }
    value = parsed;
    return true;
}

// https://app.leandoc.invalid/pkg/<tab>/<generation>/document.docx
bool ParsePackageUri(const std::string& uri, unsigned& tab, unsigned& generation) {
    if (uri.size() > 256 || uri.rfind(kPackagePrefix, 0) != 0) {
        return false;
    }
    const std::string_view rest = std::string_view(uri).substr(sizeof(kPackagePrefix) - 1);
    const std::size_t first = rest.find('/');
    if (first == std::string_view::npos) {
        return false;
    }
    const std::size_t second = rest.find('/', first + 1);
    return second != std::string_view::npos &&
           ParseDecimal(rest.substr(0, first), tab) &&
           ParseDecimal(rest.substr(first + 1, second - first - 1), generation) &&
           rest.substr(second + 1) == "document.docx";
}

// The decoded asset path below the app origin, or empty when the request is
// not a plain asset path: only letters, digits, '.', '_', '-', and '/' are
// allowed, without empty, "." or ".." segments.
std::string AssetPath(const std::string& uri) {
    if (uri.size() > 512 || uri.rfind(kAppOriginUtf8, 0) != 0) {
        return {};
    }
    std::string path = uri.substr(sizeof(kAppOriginUtf8) - 1);
    const std::size_t end = path.find_first_of("?#");
    if (end != std::string::npos) {
        path.resize(end);
    }
    if (path.empty() || path.rfind("pkg/", 0) == 0) {
        return {};
    }
    for (const char character : path) {
        const bool allowed = (character >= 'a' && character <= 'z') ||
                             (character >= 'A' && character <= 'Z') ||
                             (character >= '0' && character <= '9') || character == '.' ||
                             character == '_' || character == '-' || character == '/';
        if (!allowed) {
            return {};
        }
    }
    std::size_t start = 0;
    while (start <= path.size()) {
        const std::size_t slash = path.find('/', start);
        const std::string_view segment = std::string_view(path).substr(
            start, slash == std::string::npos ? std::string::npos : slash - start);
        if (segment.empty() || segment == "." || segment == "..") {
            return {};
        }
        if (slash == std::string::npos) {
            break;
        }
        start = slash + 1;
    }
    return path;
}

const wchar_t* AssetContentType(const std::string& path) {
    static constexpr std::pair<const char*, const wchar_t*> kTypes[] = {
        {".html", L"text/html; charset=utf-8"},
        {".css", L"text/css; charset=utf-8"},
        {".js", L"text/javascript; charset=utf-8"},
        {".mjs", L"text/javascript; charset=utf-8"},
        {".json", L"application/json"},
        {".woff2", L"font/woff2"},
        {".woff", L"font/woff"},
        {".ttf", L"font/ttf"},
        {".svg", L"image/svg+xml"},
        {".png", L"image/png"},
    };
    for (const auto& [suffix, type] : kTypes) {
        const std::size_t length = std::char_traits<char>::length(suffix);
        if (path.size() > length && path.compare(path.size() - length, length, suffix) == 0) {
            return type;
        }
    }
    return nullptr;
}

void WriteStandardError(const std::string& line) {
    // A GUI program has no console. When a caller redirects standard error,
    // for example CI with Start-Process -RedirectStandardError, it is written.
    HANDLE output = GetStdHandle(STD_ERROR_HANDLE);
    if (output == nullptr || output == INVALID_HANDLE_VALUE) {
        return;
    }
    DWORD written = 0;
    WriteFile(output, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
}

}  // namespace

LeanDocApp::LeanDocApp(LaunchOptions options)
    : pendingPaths_(std::move(options.paths)),
      smokeTest_(options.smokeTest),
      exitAfterRenderMs_(options.exitAfterRenderMs) {
    const std::wstring overrideAssets = EnvironmentValue(L"LEANDOC_ASSETS_DIR");
    assetDirectory_ = overrideAssets.empty()
                          ? (std::filesystem::path(ExecutableDirectory()) / L"assets").wstring()
                          : CanonicalPath(overrideAssets);
}

int LeanDocApp::Run(HINSTANCE instance, int showCommand) {
    instance_ = instance;
    LoadSettings();

    const HRESULT comResult =
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    const bool shouldUninitialize = SUCCEEDED(comResult);
    SetCurrentProcessExplicitAppUserModelID(L"LeanDoc.Reader");
    editor_ = ResolveEditor();

    if (!CreateMainWindow(showCommand)) {
        if (shouldUninitialize) {
            CoUninitialize();
        }
        return 1;
    }

    OpenDocuments(std::exchange(pendingPaths_, {}));
    InitializeWebView();
    if (!minimized_ && !smokeTest_) {
        SetTimer(window_, kFilePollTimer, kFilePollIntervalMs, nullptr);
    }
    if (smokeTest_) {
        SetTimer(window_, kSmokeTimer, kSmokeTimeoutMs, nullptr);
    }

    MSG message = {};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    if (shouldUninitialize) {
        CoUninitialize();
    }
    return smokeTest_ ? exitCode_ : static_cast<int>(message.wParam);
}

LeanDocApp::FileStamp LeanDocApp::ReadStamp(const std::wstring& path) {
    FileStamp stamp;
    WIN32_FILE_ATTRIBUTE_DATA data = {};
    if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data) ||
        (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
        return stamp;
    }
    stamp.writeTime = data.ftLastWriteTime;
    stamp.size = (static_cast<ULONGLONG>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
    stamp.valid = true;
    return stamp;
}

bool LeanDocApp::SameStamp(const FileStamp& left, const FileStamp& right) {
    return left.valid && right.valid && left.size == right.size &&
           left.writeTime.dwLowDateTime == right.writeTime.dwLowDateTime &&
           left.writeTime.dwHighDateTime == right.writeTime.dwHighDateTime;
}

bool LeanDocApp::CreateMainWindow(int showCommand) {
    const bool dark = EffectiveDarkTheme();
    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = WindowProcedure;
    windowClass.hInstance = instance_;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hIcon = LoadIconW(instance_, MAKEINTRESOURCEW(IDI_LEANDOC));
    windowClass.hIconSm = static_cast<HICON>(LoadImageW(
        instance_, MAKEINTRESOURCEW(IDI_LEANDOC), IMAGE_ICON,
        GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR));
    windowClass.hbrBackground = CreateSolidBrush(dark ? RGB(14, 13, 11) : RGB(250, 249, 247));
    windowClass.lpszClassName = kWindowClassName;
    if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        return false;
    }

    const UINT dpi = GetDpiForSystem();
    RECT bounds = {0, 0, MulDiv(1120, dpi, 96), MulDiv(820, dpi, 96)};
    AdjustWindowRectExForDpi(&bounds, WS_OVERLAPPEDWINDOW, FALSE, 0, dpi);

    window_ = CreateWindowExW(
        0, kWindowClassName, L"LeanDoc", WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
        bounds.right - bounds.left, bounds.bottom - bounds.top, nullptr, nullptr, instance_,
        this);
    if (window_ == nullptr) {
        return false;
    }
    ApplyWindowTheme();
    ShowWindow(window_, smokeTest_ ? SW_SHOWNOACTIVATE : showCommand);
    UpdateWindow(window_);
    TraceTiming("window-visible");
    return true;
}

LRESULT CALLBACK LeanDocApp::WindowProcedure(
    HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* app = reinterpret_cast<LeanDocApp*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        app = static_cast<LeanDocApp*>(create->lpCreateParams);
        app->window_ = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
    }
    return app == nullptr ? DefWindowProcW(window, message, wParam, lParam)
                          : app->HandleWindowMessage(message, wParam, lParam);
}

LRESULT LeanDocApp::HandleWindowMessage(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_SIZE:
            if (wParam == SIZE_MINIMIZED) {
                SetMinimized(true);
            } else {
                SetMinimized(false);
                ResizeWebView();
            }
            return 0;
        case WM_DPICHANGED: {
            const auto* suggested = reinterpret_cast<RECT*>(lParam);
            SetWindowPos(
                window_, nullptr, suggested->left, suggested->top,
                suggested->right - suggested->left, suggested->bottom - suggested->top,
                SWP_NOACTIVATE | SWP_NOZORDER);
            return 0;
        }
        case WM_GETMINMAXINFO: {
            auto* sizing = reinterpret_cast<MINMAXINFO*>(lParam);
            const UINT dpi = GetDpiForWindow(window_);
            sizing->ptMinTrackSize.x = MulDiv(640, dpi, 96);
            sizing->ptMinTrackSize.y = MulDiv(480, dpi, 96);
            return 0;
        }
        case WM_TIMER:
            if (wParam == kFilePollTimer) {
                PollActiveTab();
            } else if (wParam == kSmokeTimer) {
                CompleteSmoke(false, "timed out before the reader reported a rendered document");
            } else if (wParam == kExitAfterRenderTimer) {
                KillTimer(window_, kExitAfterRenderTimer);
                DestroyWindow(window_);
            }
            return 0;
        case WM_COPYDATA:
            return ReceiveOpenRequest(reinterpret_cast<const COPYDATASTRUCT*>(lParam)) ? TRUE
                                                                                       : FALSE;
        case kOpenPendingMessage:
            OpenDocuments(std::exchange(pendingPaths_, {}));
            return 0;
        case kRecreateWebViewMessage:
            RecreateWebView();
            return 0;
        case WM_SETTINGCHANGE:
            if (theme_ == ThemeMode::System) {
                ApplyWindowTheme();
                if (minimized_) {
                    themeChangedWhileMinimized_ = true;
                } else {
                    SendTheme();
                }
            }
            return 0;
        case WM_ERASEBKGND:
            return 1;
        case WM_DESTROY:
            KillTimer(window_, kFilePollTimer);
            KillTimer(window_, kSmokeTimer);
            KillTimer(window_, kExitAfterRenderTimer);
            if (controller_ != nullptr) {
                controller_->Close();
            }
            PostQuitMessage(exitCode_);
            return 0;
        default:
            return DefWindowProcW(window_, message, wParam, lParam);
    }
}

void LeanDocApp::Fail(const wchar_t* message) {
    if (smokeTest_) {
        CompleteSmoke(false, WideToUtf8(message));
        return;
    }
    MessageBoxW(window_, message, L"LeanDoc could not start", MB_OK | MB_ICONERROR);
}

void LeanDocApp::InitializeWebView() {
    // One user-data folder per install. Every LeanDoc process on it starts
    // with identical options, which WebView2 requires for a shared folder.
    const std::filesystem::path userData =
        std::filesystem::path(LocalAppDataDirectory()) / L"LeanDoc" / L"WebView2";
    std::error_code ignored;
    std::filesystem::create_directories(userData, ignored);

    auto options = Make<CoreWebView2EnvironmentOptions>();
    const bool keepGpu = EnvironmentValue(L"LEANDOC_BROWSER_PROFILE") == L"gpu";
    options->put_AdditionalBrowserArguments(keepGpu ? kBrowserArgumentsWithGpu
                                                    : kBrowserArguments);
    // Tracking prevention exists to block third-party web content, which the
    // reader never loads, so skip loading and matching its lists.
    ComPtr<ICoreWebView2EnvironmentOptions5> options5;
    if (SUCCEEDED(options.As(&options5))) {
        options5->put_EnableTrackingPrevention(FALSE);
    }

    const HRESULT startResult = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, userData.c_str(), options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(result) || environment == nullptr) {
                    Fail(L"LeanDoc needs the Microsoft Edge WebView2 Runtime. Install or "
                         L"repair WebView2, then try again.");
                    return S_OK;
                }
                environment_ = environment;
                return environment_->CreateCoreWebView2Controller(
                    window_,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [this](HRESULT controllerResult,
                               ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controllerResult) || controller == nullptr) {
                                Fail(L"Windows could not create LeanDoc's reader surface.");
                                return S_OK;
                            }
                            controller_ = controller;
                            controller_->get_CoreWebView2(&webView_);
                            ConfigureWebView();
                            ResizeWebView();
                            if (minimized_) {
                                controller_->put_IsVisible(FALSE);
                            }
                            NavigateToReader();
                            return S_OK;
                        })
                        .Get());
            })
            .Get());
    if (FAILED(startResult)) {
        Fail(L"LeanDoc could not initialize the WebView2 Runtime.");
    }
}

void LeanDocApp::ResizeWebView() {
    if (controller_ == nullptr || window_ == nullptr) {
        return;
    }
    RECT bounds = {};
    GetClientRect(window_, &bounds);
    controller_->put_Bounds(bounds);
}

void LeanDocApp::ConfigureWebView() {
    ComPtr<ICoreWebView2Settings> settings;
    webView_->get_Settings(&settings);
    settings->put_IsScriptEnabled(TRUE);
    settings->put_IsWebMessageEnabled(TRUE);
    settings->put_AreDefaultScriptDialogsEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_AreDefaultContextMenusEnabled(TRUE);
    settings->put_IsZoomControlEnabled(FALSE);
    settings->put_IsBuiltInErrorPageEnabled(FALSE);

    ComPtr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings.As(&settings3))) {
        settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
    }
    // The reader has no forms, downloads, or web navigation, so autofill and
    // SmartScreen reputation checks have nothing to protect.
    ComPtr<ICoreWebView2Settings4> settings4;
    if (SUCCEEDED(settings.As(&settings4))) {
        settings4->put_IsPasswordAutosaveEnabled(FALSE);
        settings4->put_IsGeneralAutofillEnabled(FALSE);
    }
    ComPtr<ICoreWebView2Settings8> settings8;
    if (SUCCEEDED(settings.As(&settings8))) {
        settings8->put_IsReputationCheckingRequired(FALSE);
    }

    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(controller_.As(&controller2))) {
        const COREWEBVIEW2_COLOR color = EffectiveDarkTheme()
                                             ? COREWEBVIEW2_COLOR{255, 14, 13, 11}
                                             : COREWEBVIEW2_COLOR{255, 250, 249, 247};
        controller2->put_DefaultBackgroundColor(color);
    }

    if (smokeTest_) {
        // The smoke check counts Content Security Policy violations from the
        // first script onwards.
        webView_->AddScriptToExecuteOnDocumentCreated(
            L"window.__leandocCspViolations = 0;"
            L"document.addEventListener('securitypolicyviolation', function () {"
            L"  window.__leandocCspViolations += 1; });",
            nullptr);
    }

    EventRegistrationToken token = {};
    webView_->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* arguments)
                -> HRESULT {
                HandleWebMessage(arguments);
                return S_OK;
            })
            .Get(),
        &token);

    webView_->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* arguments)
                -> HRESULT {
                wchar_t* rawUri = nullptr;
                arguments->get_Uri(&rawUri);
                const std::wstring uri = rawUri == nullptr ? L"" : rawUri;
                CoTaskMemFree(rawUri);
                if (StartsWithInsensitive(uri, kAppOrigin) ||
                    StartsWithInsensitive(uri, L"about:blank")) {
                    return S_OK;
                }
                arguments->put_Cancel(TRUE);
                // A file dropped on the page arrives as a navigation to its
                // file URL. It opens as a tab; the page itself never navigates.
                if (StartsWithInsensitive(uri, L"file:")) {
                    wchar_t path[32768] = {};
                    DWORD length = static_cast<DWORD>(std::size(path));
                    if (SUCCEEDED(PathCreateFromUrlW(uri.c_str(), path, &length, 0))) {
                        pendingPaths_.emplace_back(path);
                        PostMessageW(window_, kOpenPendingMessage, 0, 0);
                    }
                }
                return S_OK;
            })
            .Get(),
        &token);

    webView_->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* arguments) -> HRESULT {
                arguments->put_Handled(TRUE);
                return S_OK;
            })
            .Get(),
        &token);

    webView_->add_PermissionRequested(
        Callback<ICoreWebView2PermissionRequestedEventHandler>(
            [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* arguments) -> HRESULT {
                arguments->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
                return S_OK;
            })
            .Get(),
        &token);

    // The app origin is answered by the host: assets from the assets folder
    // and the active tab's sanitized package from memory. No folder of the
    // user's is ever mapped, and the network is never asked.
    webView_->AddWebResourceRequestedFilter(kAppFilter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    webView_->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* arguments)
                -> HRESULT {
                HandleAppRequest(arguments);
                return S_OK;
            })
            .Get(),
        &token);

    webView_->add_ProcessFailed(
        Callback<ICoreWebView2ProcessFailedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* arguments) -> HRESULT {
                COREWEBVIEW2_PROCESS_FAILED_KIND kind = {};
                if (SUCCEEDED(arguments->get_ProcessFailedKind(&kind))) {
                    HandleProcessFailed(kind);
                }
                return S_OK;
            })
            .Get(),
        &token);

    ComPtr<ICoreWebView2_4> webView4;
    if (SUCCEEDED(webView_.As(&webView4))) {
        webView4->add_DownloadStarting(
            Callback<ICoreWebView2DownloadStartingEventHandler>(
                [](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* arguments) -> HRESULT {
                    arguments->put_Cancel(TRUE);
                    return S_OK;
                })
                .Get(),
            &token);
    }
}

void LeanDocApp::NavigateToReader() {
    if (webView_ == nullptr) {
        return;
    }
    readerReady_ = false;
    webView_->Navigate(kReaderUrl);
}

void LeanDocApp::HandleProcessFailed(COREWEBVIEW2_PROCESS_FAILED_KIND kind) {
    if (smokeTest_) {
        CompleteSmoke(false, "a WebView2 process failed");
        return;
    }
    // One window holds every tab, so a crashed renderer would blank all of
    // them. Rebuild from disk, but only a few times a minute so a document
    // that crashes the renderer cannot trap the reader in a reload loop.
    const bool browserExited = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
    if (!browserExited && kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED) {
        return;
    }
    const ULONGLONG now = GetTickCount64();
    if (now - recoveryWindowStart_ > 60000) {
        recoveryWindowStart_ = now;
        recoveriesInWindow_ = 0;
    }
    if (++recoveriesInWindow_ > 3) {
        return;
    }
    if (browserExited) {
        // The controller cannot be released from inside its own event.
        PostMessageW(window_, kRecreateWebViewMessage, 0, 0);
    } else {
        NavigateToReader();
    }
}

void LeanDocApp::RecreateWebView() {
    if (controller_ != nullptr) {
        controller_->Close();
    }
    webView_ = nullptr;
    controller_ = nullptr;
    environment_ = nullptr;
    readerReady_ = false;
    ClearPackage();
    InitializeWebView();
}

void LeanDocApp::SetMinimized(bool minimized) {
    if (minimized == minimized_) {
        return;
    }
    minimized_ = minimized;
    ComPtr<ICoreWebView2_19> webView19;
    const bool canTarget = webView_ != nullptr && SUCCEEDED(webView_.As(&webView19));

    if (minimized) {
        // Nothing is on screen, so stop polling and let WebView2 trim the
        // renderer. Suspension needs the controller hidden first.
        KillTimer(window_, kFilePollTimer);
        if (controller_ == nullptr) {
            return;
        }
        controller_->put_IsVisible(FALSE);
        if (canTarget) {
            webView19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
        }
        ComPtr<ICoreWebView2_3> webView3;
        if (SUCCEEDED(webView_.As(&webView3))) {
            webView3->TrySuspend(Callback<ICoreWebView2TrySuspendCompletedHandler>(
                                     [](HRESULT, BOOL) -> HRESULT { return S_OK; })
                                     .Get());
        }
        return;
    }

    if (controller_ != nullptr) {
        if (canTarget) {
            webView19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
        }
        // Showing the controller also resumes a suspended WebView.
        controller_->put_IsVisible(TRUE);
    }
    if (!smokeTest_) {
        SetTimer(window_, kFilePollTimer, kFilePollIntervalMs, nullptr);
    }
    if (themeChangedWhileMinimized_) {
        themeChangedWhileMinimized_ = false;
        SendTheme();
    }
    PollActiveTab();
}

bool LeanDocApp::ReceiveOpenRequest(const COPYDATASTRUCT* data) {
    constexpr std::size_t kMaximumPathLength = 32767;
    if (data == nullptr || data->dwData != kOpenDocumentsCopyData ||
        data->cbData % sizeof(wchar_t) != 0 ||
        data->cbData > kMaximumForwardedPaths * (kMaximumPathLength + 1) * sizeof(wchar_t) ||
        (data->cbData != 0 && data->lpData == nullptr)) {
        return false;
    }
    // WM_COPYDATA memory is valid only during this call, so copy the paths out
    // and open them from a posted message after the sender has been released.
    const auto* text = static_cast<const wchar_t*>(data->lpData);
    const std::size_t length = data->cbData / sizeof(wchar_t);
    std::size_t start = 0;
    std::size_t accepted = 0;
    for (std::size_t index = 0; index <= length; ++index) {
        if (index != length && text[index] != L'\0') {
            continue;
        }
        const std::size_t size = index - start;
        if (size != 0 && size <= kMaximumPathLength && accepted < kMaximumForwardedPaths) {
            pendingPaths_.emplace_back(text + start, size);
            ++accepted;
        }
        start = index + 1;
    }
    if (IsIconic(window_)) {
        ShowWindow(window_, SW_RESTORE);
    }
    SetForegroundWindow(window_);
    if (accepted != 0) {
        PostMessageW(window_, kOpenPendingMessage, 0, 0);
    }
    return true;
}

LeanDocApp::Tab* LeanDocApp::FindTab(unsigned id) {
    const auto found =
        std::find_if(tabs_.begin(), tabs_.end(), [id](const Tab& tab) { return tab.id == id; });
    return found == tabs_.end() ? nullptr : &*found;
}

LeanDocApp::Tab* LeanDocApp::ActiveTab() {
    return activeTab_ == 0 ? nullptr : FindTab(activeTab_);
}

void LeanDocApp::OpenDocuments(const std::vector<std::wstring>& paths) {
    // Tabs are created from their paths alone. Only the tab that ends up
    // active is read and rendered, so opening twenty files costs one render.
    unsigned selected = 0;
    for (const std::wstring& requested : paths) {
        if (requested.empty()) {
            continue;
        }
        const std::wstring path = CanonicalPath(requested);
        const auto existing = std::find_if(tabs_.begin(), tabs_.end(), [&path](const Tab& tab) {
            return SamePath(tab.path, path);
        });
        if (existing != tabs_.end()) {
            selected = existing->id;
            continue;
        }
        if (tabs_.size() >= kMaximumTabs) {
            SendStatus("LeanDoc keeps at most 64 tabs. Close one to open more.", "warning");
            break;
        }
        Tab tab;
        tab.id = nextTabId_++;
        tab.path = path;
        tab.fileName = std::filesystem::path(path).filename().wstring();
        tabs_.push_back(std::move(tab));
        selected = tabs_.back().id;
    }
    if (selected != 0) {
        ActivateTab(selected);
    }
}

void LeanDocApp::ActivateTab(unsigned id) {
    if (FindTab(id) == nullptr) {
        return;
    }
    activeTab_ = id;
    UpdateTitle();
    if (!readerReady_) {
        return;  // The reader's "ready" message shows the active tab.
    }
    SendTabs();
    ShowActiveTab(false);
}

void LeanDocApp::CloseTab(unsigned id) {
    const auto found =
        std::find_if(tabs_.begin(), tabs_.end(), [id](const Tab& tab) { return tab.id == id; });
    if (found == tabs_.end()) {
        return;
    }
    const bool wasActive = found->id == activeTab_;
    const auto index = static_cast<std::size_t>(std::distance(tabs_.begin(), found));
    tabs_.erase(found);
    if (!wasActive) {
        SendTabs();
        return;
    }
    // Like a browser, select the tab that slid into the closed one's place.
    activeTab_ = tabs_.empty() ? 0 : tabs_[std::min(index, tabs_.size() - 1)].id;
    UpdateTitle();
    SendTabs();
    ShowActiveTab(false);
}

void LeanDocApp::ClearPackage() {
    std::string().swap(package_);
    packageTab_ = 0;
    packageGeneration_ = 0;
}

void LeanDocApp::ShowActiveTab(bool automaticReload) {
    Tab* tab = ActiveTab();
    if (tab == nullptr) {
        ClearPackage();
        UpdateTitle();
        SendEmpty();
        return;
    }

    // The stamp is taken before the read, so an edit that lands mid-read
    // shows up as a newer stamp on the next poll rather than being missed.
    const FileStamp stamp = ReadStamp(tab->path);
    if (TimingEnabled()) {
        TraceTiming("document-requested", "tab=" + std::to_string(tab->id) +
                                              " generation=" +
                                              std::to_string(tab->generation + 1));
    }
    const ULONGLONG coreStart = GetTickCount64();
    core::OpenResult result = OpenDocumentWithSharing(tab->path);
    lastCoreMs_ = GetTickCount64() - coreStart;
    if (automaticReload && !result.ok && result.errorCode == "read-failed") {
        SendStatus(
            "The file is still changing or cannot be read. Keeping the last complete view.",
            "warning");
        return;
    }

    ++tab->generation;
    tab->shown = true;
    tab->loaded = stamp;
    tab->pending = {};
    tab->missingReported = false;
    UpdateTitle();
    if (!smokeTest_) {
        AddRecent(tab->path);
    }

    const std::string report = core::ReportToJson(result);
    std::string json;
    json.reserve(report.size() + 1024);
    const bool renderable =
        result.ok && core::IsRenderableKind(result.kind) && !result.sanitizedPackage.empty();
    ClearPackage();
    if (renderable) {
        package_ = std::move(result.sanitizedPackage);
        packageTab_ = tab->id;
        packageGeneration_ = tab->generation;
        json += "{\"type\":\"document\",\"tab\":";
    } else {
        json += "{\"type\":\"fallback\",\"tab\":";
    }
    json += std::to_string(tab->id);
    json += ",\"generation\":";
    json += std::to_string(tab->generation);
    json += ",\"fileName\":\"";
    AppendJson(json, tab->fileName);
    json += "\",\"displayPath\":\"";
    AppendJson(json, tab->path);
    json += '"';
    if (renderable) {
        json += ",\"packageUrl\":\"";
        json += kPackagePrefix;
        json += std::to_string(tab->id) + "/" + std::to_string(tab->generation);
        json += "/document.docx\"";
    }
    json += ",\"report\":";
    json += report;
    json += '}';
    if (!renderable && smokeTest_) {
        CompleteSmoke(false, "the smoke fixture did not produce a renderable package");
        return;
    }
    PostJson(json);
}

void LeanDocApp::HandleAppRequest(ICoreWebView2WebResourceRequestedEventArgs* arguments) {
    if (environment_ == nullptr) {
        return;
    }
    ComPtr<ICoreWebView2WebResourceRequest> request;
    if (FAILED(arguments->get_Request(&request))) {
        return;
    }
    wchar_t* rawUri = nullptr;
    wchar_t* rawMethod = nullptr;
    request->get_Uri(&rawUri);
    request->get_Method(&rawMethod);
    const std::string uri = rawUri == nullptr ? std::string() : WideToUtf8(rawUri);
    const bool isGet = rawMethod != nullptr && std::wstring_view(rawMethod) == L"GET";
    CoTaskMemFree(rawUri);
    CoTaskMemFree(rawMethod);

    const std::wstring commonHeaders =
        L"X-Content-Type-Options: nosniff\r\nCache-Control: no-store";
    const auto respond = [this, arguments](IStream* content, int status, const wchar_t* reason,
                                           const std::wstring& headers) {
        ComPtr<ICoreWebView2WebResourceResponse> response;
        if (SUCCEEDED(environment_->CreateWebResourceResponse(
                content, status, reason, headers.c_str(), &response))) {
            arguments->put_Response(response.Get());
        }
    };

    if (!isGet) {
        respond(nullptr, 404, L"Not Found", commonHeaders);
        return;
    }
    if (uri.rfind(kPackagePrefix, 0) != 0) {
        ServeAsset(uri, respond, commonHeaders);
        return;
    }

    unsigned tab = 0;
    unsigned generation = 0;
    if (!ParsePackageUri(uri, tab, generation) || package_.empty() ||
        tab != packageTab_ || generation != packageGeneration_ || tab != activeTab_ ||
        package_.size() > UINT_MAX) {
        respond(nullptr, 404, L"Not Found", commonHeaders);
        return;
    }
    if (TimingEnabled()) {
        TraceTiming("package-served", "tab=" + std::to_string(tab) +
                                          " generation=" + std::to_string(generation) +
                                          " coreMs=" + std::to_string(lastCoreMs_) +
                                          " bytes=" + std::to_string(package_.size()));
    }
    ComPtr<IStream> stream;
    stream.Attach(SHCreateMemStream(
        reinterpret_cast<const BYTE*>(package_.data()), static_cast<UINT>(package_.size())));
    if (stream == nullptr) {
        respond(nullptr, 404, L"Not Found", commonHeaders);
        return;
    }
    respond(stream.Get(), 200, L"OK",
            std::wstring(L"Content-Type: ") + kDocxContentType + L"\r\n" + commonHeaders);
}

template <typename Respond>
void LeanDocApp::ServeAsset(
    const std::string& uri, const Respond& respond, const std::wstring& commonHeaders) {
    const std::string relative = AssetPath(uri);
    const wchar_t* contentType = relative.empty() ? nullptr : AssetContentType(relative);
    if (contentType == nullptr) {
        respond(nullptr, 404, L"Not Found", commonHeaders);
        return;
    }
    std::wstring candidate = assetDirectory_;
    if (!candidate.empty() && candidate.back() != L'\\') {
        candidate.push_back(L'\\');
    }
    for (const wchar_t character : Utf8ToWide(relative)) {
        candidate.push_back(character == L'/' ? L'\\' : character);
    }
    WIN32_FILE_ATTRIBUTE_DATA data = {};
    const bool regular =
        core::IsPathWithin(std::filesystem::path(assetDirectory_), std::filesystem::path(candidate)) &&
        GetFileAttributesExW(candidate.c_str(), GetFileExInfoStandard, &data) &&
        (data.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) == 0 &&
        ((static_cast<ULONGLONG>(data.nFileSizeHigh) << 32) | data.nFileSizeLow) <= kMaximumAssetBytes;
    ComPtr<IStream> stream;
    if (!regular || FAILED(SHCreateStreamOnFileEx(candidate.c_str(), STGM_READ | STGM_SHARE_DENY_WRITE,
                                                  FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &stream))) {
        respond(nullptr, 404, L"Not Found", commonHeaders);
        return;
    }
    respond(stream.Get(), 200, L"OK",
            std::wstring(L"Content-Type: ") + contentType + L"\r\n" + commonHeaders);
}

void LeanDocApp::OpenDocumentDialog() {
    ComPtr<IFileOpenDialog> dialog;
    if (FAILED(CoCreateInstance(
            CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) {
        SendStatus("Windows could not open the file picker.", "error");
        return;
    }
    const COMDLG_FILTERSPEC filters[] = {
        {L"Word documents", L"*.docx;*.dotx;*.docm;*.dotm;*.doc;*.rtf;*.odt"},
        {L"All files", L"*.*"}};
    dialog->SetFileTypes(static_cast<UINT>(std::size(filters)), filters);
    dialog->SetTitle(L"Open documents");
    DWORD options = 0;
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT);
    if (dialog->Show(window_) != S_OK) {
        return;
    }
    ComPtr<IShellItemArray> selected;
    if (FAILED(dialog->GetResults(&selected))) {
        return;
    }
    DWORD count = 0;
    selected->GetCount(&count);
    std::vector<std::wstring> paths;
    for (DWORD index = 0; index < count; ++index) {
        ComPtr<IShellItem> item;
        if (FAILED(selected->GetItemAt(index, &item))) {
            continue;
        }
        wchar_t* rawPath = nullptr;
        if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &rawPath)) && rawPath != nullptr) {
            paths.emplace_back(rawPath);
        }
        CoTaskMemFree(rawPath);
    }
    OpenDocuments(paths);
}

void LeanDocApp::PollActiveTab() {
    // Only the visible tab is watched. A background tab is read again when it
    // is selected, so it can never show a stale document.
    Tab* tab = ActiveTab();
    if (tab == nullptr || !tab->shown || !readerReady_) {
        return;
    }
    const FileStamp current = ReadStamp(tab->path);
    if (!current.valid) {
        if (!tab->missingReported) {
            SendStatus("The file was moved or deleted. The last complete view is still shown.",
                       "warning");
            tab->missingReported = true;
        }
        return;
    }
    tab->missingReported = false;
    if (SameStamp(current, tab->loaded)) {
        tab->pending.valid = false;
        return;
    }
    if (!SameStamp(current, tab->pending)) {
        tab->pending = current;
        tab->pendingSince = GetTickCount64();
        return;
    }
    if (GetTickCount64() - tab->pendingSince >= 350) {
        ShowActiveTab(true);
    }
}

void LeanDocApp::UpdateTitle() {
    const Tab* tab = ActiveTab();
    const std::wstring title = tab == nullptr || tab->fileName.empty()
                                   ? std::wstring(L"LeanDoc")
                                   : tab->fileName + L" - LeanDoc";
    SetWindowTextW(window_, title.c_str());
}

void LeanDocApp::PostJson(const std::string& json) {
    if (webView_ == nullptr || !readerReady_) {
        return;
    }
    const std::wstring wide = Utf8ToWide(json);
    if (!wide.empty()) {
        webView_->PostWebMessageAsJson(wide.c_str());
    }
}

void LeanDocApp::SendHost() {
    std::string json = "{\"type\":\"host\",\"platform\":\"windows\",\"version\":\"";
    json += LEANDOC_VERSION_STRING;
    json += "\",\"editor\":{\"kind\":\"";
    json += EditorKindName(editor_.kind);
    json += "\",\"label\":\"";
    core::AppendJsonString(json, editor_.label);
    json += "\"},\"tabs\":true}";
    PostJson(json);
}

void LeanDocApp::SendTheme() {
    std::string json = "{\"type\":\"theme\",\"theme\":\"";
    json += ThemeName();
    json += "\",\"view\":\"";
    json += view_;
    json += "\"}";
    PostJson(json);
}

void LeanDocApp::SendTabs() {
    std::string json = "{\"type\":\"tabs\",\"active\":";
    json += std::to_string(activeTab_);
    json += ",\"tabs\":[";
    for (std::size_t index = 0; index < tabs_.size(); ++index) {
        const Tab& tab = tabs_[index];
        json += index == 0 ? "{\"id\":" : ",{\"id\":";
        json += std::to_string(tab.id);
        json += ",\"name\":\"";
        AppendJson(json, tab.fileName);
        json += "\",\"path\":\"";
        AppendJson(json, tab.path);
        json += "\"}";
    }
    json += "]}";
    PostJson(json);
}

void LeanDocApp::SendEmpty() {
    std::string json = "{\"type\":\"empty\",\"recent\":[";
    for (std::size_t index = 0; index < recent_.size(); ++index) {
        json += index == 0 ? "{\"path\":\"" : ",{\"path\":\"";
        AppendJson(json, recent_[index]);
        json += "\",\"name\":\"";
        AppendJson(json, std::filesystem::path(recent_[index]).filename().wstring());
        json += "\"}";
    }
    json += "]}";
    PostJson(json);
}

void LeanDocApp::SendStatus(std::string_view message, const char* tone) {
    std::string json = "{\"type\":\"status\",\"message\":\"";
    core::AppendJsonString(json, message);
    json += "\",\"tone\":\"";
    json += tone == nullptr ? "info" : tone;
    json += "\"}";
    PostJson(json);
}

void LeanDocApp::HandleWebMessage(ICoreWebView2WebMessageReceivedEventArgs* arguments) {
    wchar_t* rawSource = nullptr;
    arguments->get_Source(&rawSource);
    const std::wstring source = rawSource == nullptr ? L"" : rawSource;
    CoTaskMemFree(rawSource);
    if (!StartsWithInsensitive(source, kAppOrigin)) {
        return;
    }
    wchar_t* rawJson = nullptr;
    if (FAILED(arguments->get_WebMessageAsJson(&rawJson)) || rawJson == nullptr) {
        CoTaskMemFree(rawJson);
        return;
    }
    const std::string json = WideToUtf8(rawJson);
    CoTaskMemFree(rawJson);
    const auto message = host_json::ParseMessage(json);
    if (!message) {
        return;
    }
    const auto type = host_json::GetString(*message, "type");
    if (!type) {
        return;
    }

    if (*type == "ready") {
        TraceTiming("webview-ready");
        readerReady_ = true;
        SendHost();
        SendTheme();
        SendTabs();
        ShowActiveTab(false);
        return;
    }
    if (!readerReady_) {
        return;
    }
    if (*type == "rendered" || *type == "renderFailed") {
        HandleRendered(*message, *type == "renderFailed");
    } else if (*type == "open") {
        OpenDocumentDialog();
    } else if (*type == "openRecent") {
        const auto path = host_json::GetString(*message, "path");
        if (path) {
            const std::wstring wide = Utf8ToWide(*path);
            const bool known = std::any_of(recent_.begin(), recent_.end(),
                                           [&wide](const std::wstring& item) {
                                               return SamePath(item, wide);
                                           });
            if (known) {
                OpenDocuments({wide});
            }
        }
    } else if (*type == "clearRecent") {
        recent_.clear();
        SaveSettings();
        if (ActiveTab() == nullptr) {
            SendEmpty();
        }
    } else if (*type == "openInEditor") {
        OpenInEditor(host_json::GetUnsigned(*message, "tab").value_or(activeTab_));
    } else if (*type == "link") {
        if (const auto href = host_json::GetString(*message, "href")) {
            HandleLink(*href);
        }
    } else if (*type == "setTheme") {
        const auto theme = host_json::GetString(*message, "theme");
        if (theme && (*theme == "system" || *theme == "light" || *theme == "dark")) {
            theme_ = *theme == "light"  ? ThemeMode::Light
                     : *theme == "dark" ? ThemeMode::Dark
                                        : ThemeMode::System;
            SaveSettings();
            ApplyWindowTheme();
            SendTheme();
        }
    } else if (*type == "setView") {
        const auto view = host_json::GetString(*message, "view");
        if (view && (*view == "page" || *view == "reading")) {
            view_ = *view;
            SaveSettings();
        }
    } else if (*type == "selectTab") {
        const auto id = host_json::GetUnsigned(*message, "id");
        if (id && *id != activeTab_) {
            ActivateTab(*id);
        }
    } else if (*type == "closeTab") {
        if (const auto id = host_json::GetUnsigned(*message, "id")) {
            CloseTab(*id);
        }
    } else if (*type == "reload") {
        if (ActiveTab() != nullptr) {
            ShowActiveTab(false);
        }
    }
}

void LeanDocApp::HandleRendered(const host_json::Object& message, bool failed) {
    const auto tab = host_json::GetUnsigned(message, "tab");
    const auto generation = host_json::GetUnsigned(message, "generation");
    const Tab* active = ActiveTab();
    // A message for an older generation describes a view that is gone.
    if (!tab || !generation || active == nullptr || *tab != active->id ||
        *generation != active->generation) {
        return;
    }
    if (!failed) {
        if (TimingEnabled()) {
            TraceTiming(
                "rendered",
                "tab=" + std::to_string(*tab) + " generation=" + std::to_string(*generation) +
                    " pages=" +
                    std::to_string(host_json::GetUnsigned(message, "pages").value_or(0)) +
                    " readerMs=" +
                    std::to_string(host_json::GetUnsigned(message, "ms").value_or(0)));
        }
        if (exitAfterRenderMs_ && !firstRenderSeen_) {
            SetTimer(window_, kExitAfterRenderTimer, *exitAfterRenderMs_, nullptr);
        }
        firstRenderSeen_ = true;
    }
    if (!smokeTest_) {
        return;
    }
    if (failed) {
        CompleteSmoke(false, "the reader reported renderFailed: " +
                                 host_json::GetString(message, "message").value_or(""));
        return;
    }
    smokeRenderMs_ = host_json::GetUnsigned(message, "ms").value_or(0);
    StartSmokeProbe();
}

void LeanDocApp::HandleLink(const std::string& href) {
    if (href.empty() || href.size() > 8192) {
        return;
    }
    // Only web and mail links, opened by the system handler after a click.
    const bool web = href.rfind("https://", 0) == 0 || href.rfind("http://", 0) == 0;
    const bool mail = href.rfind("mailto:", 0) == 0;
    const std::size_t hostStart = href.find("://") == std::string::npos ? 0 : href.find("://") + 3;
    const bool hasHost = web && hostStart < href.size() && href[hostStart] != '/' &&
                         href[hostStart] != '?' && href[hostStart] != '#';
    const bool clean = std::none_of(href.begin(), href.end(), [](char character) {
        const auto byte = static_cast<unsigned char>(character);
        return byte <= 0x20 || byte == 0x7F || character == '"' || character == '\\';
    });
    if (!clean || !((web && hasHost) || mail)) {
        SendStatus("LeanDoc opens web and email links only.", "warning");
        return;
    }
    const std::wstring wide = Utf8ToWide(href);
    const auto result = reinterpret_cast<INT_PTR>(
        ShellExecuteW(window_, L"open", wide.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    if (result <= 32) {
        SendStatus("Windows could not open that link.", "error");
    }
}

void LeanDocApp::OpenInEditor(unsigned tabId) {
    const Tab* tab = FindTab(tabId);
    if (tab == nullptr) {
        tab = ActiveTab();
    }
    if (tab == nullptr) {
        return;
    }
    switch (LaunchEditor(editor_, tab->path)) {
        case LaunchResult::Started:
            break;
        case LaunchResult::OpenedWeb:
            SendStatus(
                "Word for the web opened in your browser. Upload the file there to read or "
                "edit it.",
                "info");
            break;
        default:
            SendStatus("LeanDoc could not start the editor.", "error");
            break;
    }
}

void LeanDocApp::StartSmokeProbe() {
    if (smokeComplete_ || smokeProbeStarted_ || webView_ == nullptr) {
        return;
    }
    smokeProbeStarted_ = true;
    // A page exists in the DOM and has text, no resource came from outside the
    // app origin, and the Content Security Policy reported nothing.
    static constexpr wchar_t kProbe[] = LR"JS(
(function () {
  var origin = location.protocol + "//" + location.host + "/";
  var root = document.documentElement;
  var pages = Math.min(
    document.querySelectorAll("section.docx").length,
    parseInt(root.dataset.pages || "0", 10) || 0);
  var text = (document.body ? document.body.innerText : "").trim().length;
  var offOrigin = performance.getEntriesByType("resource").filter(function (entry) {
    return entry.name.indexOf(origin) !== 0 && !/^(blob|data):/i.test(entry.name);
  }).map(function (entry) { return entry.name; });
  return JSON.stringify({
    state: root.dataset.renderState || "",
    pages: pages,
    text: text,
    offOrigin: offOrigin.length,
    firstOffOrigin: offOrigin[0] || "",
    csp: window.__leandocCspViolations || 0
  });
}())
)JS";
    webView_->ExecuteScript(
        kProbe,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this](HRESULT result, LPCWSTR resultJson) -> HRESULT {
                if (FAILED(result) || resultJson == nullptr) {
                    CompleteSmoke(false, "the DOM probe failed");
                    return S_OK;
                }
                std::string inner;
                host_json::Object values;
                const std::string outer = WideToUtf8(resultJson);
                if (!host_json::Parser(outer).ParseStringDocument(inner) ||
                    !host_json::Parser(inner).ParseObjectDocument(values)) {
                    CompleteSmoke(false, "the DOM probe returned " + outer);
                    return S_OK;
                }
                const bool success =
                    host_json::GetString(values, "state").value_or("") == "ready" &&
                    host_json::GetUnsigned(values, "pages").value_or(0) >= 1 &&
                                     host_json::GetUnsigned(values, "text").value_or(0) > 0 &&
                                     host_json::GetUnsigned(values, "offOrigin").value_or(1) == 0 &&
                                     host_json::GetUnsigned(values, "csp").value_or(1) == 0;
                CompleteSmoke(success, inner + " renderMs=" + std::to_string(smokeRenderMs_));
                return S_OK;
            })
            .Get());
}

void LeanDocApp::CompleteSmoke(bool success, const std::string& detail) {
    if (!smokeTest_ || smokeComplete_) {
        return;
    }
    smokeComplete_ = true;
    exitCode_ = success ? 0 : 1;
    WriteStandardError(std::string("LeanDoc Windows smoke: ") + (success ? "PASS: " : "FAIL: ") +
                       detail + "\n");
    if (window_ != nullptr) {
        DestroyWindow(window_);
    } else {
        PostQuitMessage(exitCode_);
    }
}

void LeanDocApp::LoadSettings() {
    wchar_t value[16] = {};
    DWORD bytes = sizeof(value);
    if (RegGetValueW(HKEY_CURRENT_USER, kSettingsKey, L"Theme", RRF_RT_REG_SZ, nullptr, value,
                     &bytes) == ERROR_SUCCESS) {
        const std::wstring saved(value);
        theme_ = saved == L"light" ? ThemeMode::Light
                 : saved == L"dark" ? ThemeMode::Dark
                                    : ThemeMode::System;
    }
    bytes = sizeof(value);
    if (RegGetValueW(HKEY_CURRENT_USER, kSettingsKey, L"View", RRF_RT_REG_SZ, nullptr, value,
                     &bytes) == ERROR_SUCCESS) {
        view_ = std::wstring(value) == L"reading" ? "reading" : "page";
    }
    DWORD recentBytes = 0;
    if (RegGetValueW(HKEY_CURRENT_USER, kSettingsKey, L"Recent", RRF_RT_REG_MULTI_SZ, nullptr,
                     nullptr, &recentBytes) == ERROR_SUCCESS &&
        recentBytes > 0 && recentBytes < 1024 * 1024) {
        std::wstring buffer(recentBytes / sizeof(wchar_t) + 1, L'\0');
        if (RegGetValueW(HKEY_CURRENT_USER, kSettingsKey, L"Recent", RRF_RT_REG_MULTI_SZ,
                         nullptr, buffer.data(), &recentBytes) == ERROR_SUCCESS) {
            std::size_t start = 0;
            while (start < buffer.size() && buffer[start] != L'\0' &&
                   recent_.size() < kMaximumRecent) {
                const std::size_t end = buffer.find(L'\0', start);
                recent_.push_back(buffer.substr(start, end - start));
                start = end + 1;
            }
        }
    }
}

void LeanDocApp::SaveSettings() const {
    if (smokeTest_) {
        return;
    }
    HKEY key = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, kSettingsKey, 0, nullptr, 0, KEY_SET_VALUE, nullptr,
                        &key, nullptr) != ERROR_SUCCESS) {
        return;
    }
    const std::wstring theme = Utf8ToWide(ThemeName());
    RegSetValueExW(key, L"Theme", 0, REG_SZ, reinterpret_cast<const BYTE*>(theme.c_str()),
                   static_cast<DWORD>((theme.size() + 1) * sizeof(wchar_t)));
    const std::wstring view = Utf8ToWide(view_);
    RegSetValueExW(key, L"View", 0, REG_SZ, reinterpret_cast<const BYTE*>(view.c_str()),
                   static_cast<DWORD>((view.size() + 1) * sizeof(wchar_t)));
    std::wstring multi;
    for (const std::wstring& path : recent_) {
        multi += path;
        multi.push_back(L'\0');
    }
    multi.push_back(L'\0');
    RegSetValueExW(key, L"Recent", 0, REG_MULTI_SZ, reinterpret_cast<const BYTE*>(multi.data()),
                   static_cast<DWORD>(multi.size() * sizeof(wchar_t)));
    RegCloseKey(key);
}

void LeanDocApp::AddRecent(const std::wstring& path) {
    recent_.erase(std::remove_if(recent_.begin(), recent_.end(),
                                 [&path](const std::wstring& item) { return SamePath(item, path); }),
                  recent_.end());
    recent_.insert(recent_.begin(), path);
    if (recent_.size() > kMaximumRecent) {
        recent_.resize(kMaximumRecent);
    }
    SaveSettings();
}

void LeanDocApp::ApplyWindowTheme() {
    if (window_ == nullptr) {
        return;
    }
    const BOOL dark = EffectiveDarkTheme() ? TRUE : FALSE;
    constexpr DWORD kImmersiveDarkMode = 20;
    if (FAILED(DwmSetWindowAttribute(window_, kImmersiveDarkMode, &dark, sizeof(dark)))) {
        constexpr DWORD kImmersiveDarkModeLegacy = 19;
        DwmSetWindowAttribute(window_, kImmersiveDarkModeLegacy, &dark, sizeof(dark));
    }
    ComPtr<ICoreWebView2Controller2> controller2;
    if (controller_ != nullptr && SUCCEEDED(controller_.As(&controller2))) {
        const COREWEBVIEW2_COLOR color = dark ? COREWEBVIEW2_COLOR{255, 14, 13, 11}
                                              : COREWEBVIEW2_COLOR{255, 250, 249, 247};
        controller2->put_DefaultBackgroundColor(color);
    }
}

bool LeanDocApp::EffectiveDarkTheme() const {
    if (theme_ == ThemeMode::Dark) {
        return true;
    }
    if (theme_ == ThemeMode::Light) {
        return false;
    }
    return SystemUsesDarkApps();
}

const char* LeanDocApp::ThemeName() const {
    switch (theme_) {
        case ThemeMode::Light:
            return "light";
        case ThemeMode::Dark:
            return "dark";
        default:
            return "system";
    }
}

}  // namespace leandoc::windows_host
