#pragma once

#include <windows.h>
#include <wrl.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <WebView2.h>

#include "EditorChoice.h"
#include "HostJson.h"

namespace leandoc::windows_host {

struct LaunchOptions {
    std::vector<std::wstring> paths;
    bool smokeTest = false;
    // --exit-after-render=MS: close MS milliseconds after the first rendered.
    std::optional<unsigned> exitAfterRenderMs;
};

class LeanDocApp {
public:
    // Shared with main.cpp, which hands a second launch's documents to the
    // running window instead of starting another browser process.
    static constexpr wchar_t kWindowClassName[] = L"LeanDoc.Reader.Window";
    static constexpr ULONG_PTR kOpenDocumentsCopyData = 0x4C444331;  // "LDC1"
    static constexpr std::size_t kMaximumForwardedPaths = 64;

    explicit LeanDocApp(LaunchOptions options);
    int Run(HINSTANCE instance, int showCommand);

private:
    enum class ThemeMode { System, Light, Dark };

    struct FileStamp {
        FILETIME writeTime = {};
        ULONGLONG size = 0;
        bool valid = false;
    };

    // A tab keeps only what the tab strip and the file watcher need. The
    // sanitized package of the active tab is the only document data held, and
    // a background tab is read from disk again when it is selected.
    struct Tab {
        unsigned id = 0;
        std::wstring path;
        std::wstring fileName;
        unsigned generation = 0;
        bool shown = false;
        FileStamp loaded;
        FileStamp pending;
        ULONGLONG pendingSince = 0;
        bool missingReported = false;
    };

    static constexpr UINT_PTR kFilePollTimer = 1;
    static constexpr UINT_PTR kSmokeTimer = 2;
    static constexpr UINT_PTR kExitAfterRenderTimer = 3;
    static constexpr UINT kFilePollIntervalMs = 500;
    static constexpr UINT kSmokeTimeoutMs = 18000;
    static constexpr UINT kOpenPendingMessage = WM_APP + 1;
    static constexpr UINT kRecreateWebViewMessage = WM_APP + 2;
    static constexpr std::size_t kMaximumTabs = 64;
    static constexpr std::size_t kMaximumRecent = 10;

    static FileStamp ReadStamp(const std::wstring& path);
    static bool SameStamp(const FileStamp& left, const FileStamp& right);

    static LRESULT CALLBACK WindowProcedure(
        HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT HandleWindowMessage(UINT message, WPARAM wParam, LPARAM lParam);

    bool CreateMainWindow(int showCommand);
    void InitializeWebView();
    void ConfigureWebView();
    void ResizeWebView();
    void NavigateToReader();
    void OpenDroppedFile(const std::wstring& path);
    void RecreateWebView();
    void HandleProcessFailed(COREWEBVIEW2_PROCESS_FAILED_KIND kind);
    void SetMinimized(bool minimized);
    void Fail(const wchar_t* message);

    bool ReceiveOpenRequest(const COPYDATASTRUCT* data);
    void OpenDocuments(const std::vector<std::wstring>& paths);
    void ActivateTab(unsigned id);
    void CloseTab(unsigned id);
    void ShowActiveTab(bool automaticReload);
    void ClearPackage();
    Tab* FindTab(unsigned id);
    Tab* ActiveTab();
    void HandleAppRequest(ICoreWebView2WebResourceRequestedEventArgs* arguments);
    template <typename Respond>
    void ServeAsset(
        const std::string& uri, const Respond& respond, const std::wstring& commonHeaders);

    void OpenDocumentDialog();
    void PollActiveTab();
    void UpdateTitle();

    void PostJson(const std::string& json);
    void SendHost();
    void SendTheme();
    void SendTabs();
    void SendEmpty();
    void SendStatus(std::string_view message, const char* tone = "info");
    void HandleWebMessage(ICoreWebView2WebMessageReceivedEventArgs* arguments);
    void HandleRendered(const host_json::Object& message, bool failed);
    void HandleLink(const std::string& href);
    void OpenInEditor(unsigned tabId);

    void StartSmokeProbe();
    void CompleteSmoke(bool success, const std::string& detail);

    void LoadSettings();
    void SaveSettings() const;
    void AddRecent(const std::wstring& path);
    void ApplyWindowTheme();
    bool EffectiveDarkTheme() const;
    const char* ThemeName() const;

    HINSTANCE instance_ = nullptr;
    HWND window_ = nullptr;
    std::wstring assetDirectory_;
    std::vector<std::wstring> pendingPaths_;
    bool smokeTest_ = false;
    bool smokeComplete_ = false;
    bool smokeProbeStarted_ = false;
    int exitCode_ = 0;
    unsigned smokeRenderMs_ = 0;
    bool firstRenderSeen_ = false;
    std::optional<unsigned> exitAfterRenderMs_;
    std::uint64_t lastCoreMs_ = 0;

    Microsoft::WRL::ComPtr<ICoreWebView2Environment> environment_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> webView_;

    std::vector<Tab> tabs_;
    unsigned activeTab_ = 0;
    unsigned nextTabId_ = 1;

    // The sanitized package of the active tab, answered from memory at
    // https://app.leandoc.invalid/pkg/<tab>/<generation>/document.docx.
    std::string package_;
    unsigned packageTab_ = 0;
    unsigned packageGeneration_ = 0;

    bool readerReady_ = false;
    bool minimized_ = false;
    bool themeChangedWhileMinimized_ = false;
    ULONGLONG recoveryWindowStart_ = 0;
    unsigned recoveriesInWindow_ = 0;

    ThemeMode theme_ = ThemeMode::System;
    std::string view_ = "page";
    std::vector<std::wstring> recent_;
    EditorChoice editor_;
};

}  // namespace leandoc::windows_host
