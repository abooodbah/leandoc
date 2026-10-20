#pragma once

#include <gtk/gtk.h>
#include <webkit/webkit.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "EditorChoice.h"
#include "TestHooks.h"
#include "core/DocCore.h"

namespace leandoc::linux_host {

struct HostOptions {
    bool smokeTest = false;
    // --exit-after-render=MS: quit MS milliseconds after the first rendered.
    std::optional<unsigned> exitAfterRenderMs;
    // --test-script FILE: commands that drive the window (TestHooks.h).
    std::optional<std::filesystem::path> testScript;
};

// One LeanDoc window. Every document is a tab of it: GApplication forwards a
// later launch's files here through the "open" signal.
class LinuxApp final {
public:
    static LinuxApp* Create(
        GtkApplication* application,
        const HostOptions& options,
        int* smokeExitCode);

    LinuxApp(const LinuxApp&) = delete;
    LinuxApp& operator=(const LinuxApp&) = delete;

    // Adds each path as a tab (or selects its existing tab) and shows the last.
    void OpenPaths(const std::vector<std::filesystem::path>& paths);
    void Present();

private:
    enum class ThemeMode { System, Light, Dark };

    // A tab keeps only its path and generation. The sanitized package of the
    // active tab is the only document data the host holds.
    struct Tab {
        unsigned id = 0;
        std::filesystem::path path;
        std::string name;
        unsigned generation = 0;
        bool shown = false;
    };

    LinuxApp(GtkApplication* application, const HostOptions& options, int* smokeExitCode);
    ~LinuxApp();

    void Initialize();
    void ConfigureWebView();
    void NavigateToReader();
    void ResolveEditor();

    Tab* FindTab(unsigned id);
    Tab* ActiveTab();
    void ActivateTab(unsigned id);
    void CloseTab(unsigned id);
    void ShowActiveTab(bool automaticReload);
    void ClearPackage();
    void WatchActiveTab();
    void ScheduleReload();

    void OpenDocumentDialog();
    void OpenInEditor(unsigned tabId);
    void LaunchEditor(const std::filesystem::path& path);
    void HandleLink(std::string_view href);
    void HandleMessage(JSCValue* message);
    void HandleRendered(JSCValue* message, bool failed);

    void SendJson(const std::string& json);
    void SendHost();
    void SendTheme();
    void SendTabs();
    void SendEmpty();
    void SendStatus(std::string_view message, std::string_view tone = "info");

    void LoadSettings();
    void SaveSettings() const;
    void AddRecent(const std::filesystem::path& path);
    void ApplyWindowTheme();
    std::string ThemeName() const;
    void UpdateTitle();

    // --test-script: inert unless testScript_ is set.
    void StartTestScript();
    void ReadNextScriptLine();
    void RunScriptLine(const std::string& line);
    void EvaluateScriptJs(const std::string& body);
    void PollScriptWait();
    void FinishScriptCommand(bool ok, std::string_view result);
    void ArmScriptDeadline();
    std::uint64_t ScriptElapsedMs(std::chrono::steady_clock::time_point since) const;

    void StartSmokeProbe();
    void CompleteSmoke(bool success, std::string_view reason);

    void HandleScheme(WebKitURISchemeRequest* request);
    void ServePackage(WebKitURISchemeRequest* request, std::string_view path);
    void ServeAsset(WebKitURISchemeRequest* request, std::string_view path);

    static void OnWindowFinalized(gpointer data, GObject* object);
    static void OnScheme(WebKitURISchemeRequest* request, gpointer data);
    static void OnScriptMessage(
        WebKitUserContentManager* manager,
        JSCValue* value,
        gpointer data);
    static gboolean OnDecidePolicy(
        WebKitWebView* view,
        WebKitPolicyDecision* decision,
        WebKitPolicyDecisionType type,
        gpointer data);
    static gboolean OnContextMenu(
        WebKitWebView* view,
        WebKitContextMenu* menu,
        WebKitHitTestResult* hitTest,
        gpointer data);
    static GtkWidget* OnCreateWebView(
        WebKitWebView* view,
        WebKitNavigationAction* action,
        gpointer data);
    static gboolean OnPermissionRequest(
        WebKitWebView* view,
        WebKitPermissionRequest* request,
        gpointer data);
    static gboolean OnQueryPermissionState(
        WebKitWebView* view,
        WebKitPermissionStateQuery* query,
        gpointer data);
    static void OnDownloadStarted(
        WebKitNetworkSession* session,
        WebKitDownload* download,
        gpointer data);
    static gboolean OnScriptDialog(
        WebKitWebView* view,
        WebKitScriptDialog* dialog,
        gpointer data);
    static gboolean OnRunFileChooser(
        WebKitWebView* view,
        WebKitFileChooserRequest* request,
        gpointer data);
    static gboolean OnEnterFullscreen(WebKitWebView* view, gpointer data);
    static gboolean OnPrint(
        WebKitWebView* view,
        WebKitPrintOperation* operation,
        gpointer data);
    static void OnWebProcessTerminated(
        WebKitWebView* view,
        WebKitWebProcessTerminationReason reason,
        gpointer data);
    static gboolean OnDrop(
        GtkDropTarget* target,
        const GValue* value,
        double x,
        double y,
        gpointer data);
    static void OnOpenDialogFinished(
        GObject* source,
        GAsyncResult* result,
        gpointer data);
    static void OnDirectoryChanged(
        GFileMonitor* monitor,
        GFile* file,
        GFile* otherFile,
        GFileMonitorEvent event,
        gpointer data);
    static void OnSmokeProbeFinished(
        GObject* source,
        GAsyncResult* result,
        gpointer data);
    static gboolean OnReloadTimer(gpointer data);
    static gboolean OnSmokeTimeout(gpointer data);
    static void OnScriptOpened(GObject* source, GAsyncResult* result, gpointer data);
    static void OnScriptLine(GObject* source, GAsyncResult* result, gpointer data);
    static void OnScriptJsFinished(GObject* source, GAsyncResult* result, gpointer data);
    static gboolean OnScriptTimer(gpointer data);
    static gboolean OnScriptDeadline(gpointer data);
    static gboolean OnExitAfterRender(gpointer data);
    static void OnWindowMapped(GtkWidget* widget, gpointer data);

    GtkApplication* application_ = nullptr;
    GtkWidget* window_ = nullptr;
    WebKitWebView* webView_ = nullptr;
    WebKitWebContext* webContext_ = nullptr;
    WebKitNetworkSession* networkSession_ = nullptr;
    WebKitUserContentManager* contentManager_ = nullptr;

    std::filesystem::path assetRoot_;
    std::vector<Tab> tabs_;
    unsigned activeTab_ = 0;
    unsigned nextTabId_ = 1;

    // The sanitized package of the active tab, served from memory at
    // leandoc://app/pkg/<tab>/<generation>/document.docx.
    GBytes* package_ = nullptr;
    unsigned packageTab_ = 0;
    unsigned packageGeneration_ = 0;

    GFileMonitor* directoryMonitor_ = nullptr;
    guint reloadTimer_ = 0;

    ThemeMode theme_ = ThemeMode::System;
    std::string view_ = "page";
    std::vector<std::string> recent_;
    EditorChoice editor_;

    bool readerReady_ = false;
    bool smokeTest_ = false;
    std::optional<unsigned> exitAfterRenderMs_;
    guint exitTimer_ = 0;
    bool firstRenderSeen_ = false;
    std::uint64_t lastCoreMs_ = 0;
    bool smokeComplete_ = false;
    bool smokeProbeStarted_ = false;
    int* smokeExitCode_ = nullptr;
    guint smokeTimeout_ = 0;
    std::uint64_t smokeRenderMs_ = 0;

    // --test-script state.
    std::optional<std::filesystem::path> testScript_;
    GCancellable* scriptCancel_ = nullptr;
    GDataInputStream* scriptStream_ = nullptr;
    bool scriptStarted_ = false;
    bool scriptFailed_ = false;
    bool scriptWaitingRender_ = false;
    unsigned scriptLine_ = 0;
    unsigned scriptTimeoutMs_ = 30000;
    ScriptCommand scriptCommand_;
    std::chrono::steady_clock::time_point scriptCommandStart_;
    std::chrono::steady_clock::time_point renderMarkStart_;
    unsigned renderedCount_ = 0;
    unsigned renderMark_ = 0;
    bool lastRenderFailed_ = false;
    std::string lastRenderDetails_;
    guint scriptTimer_ = 0;
    guint scriptDeadline_ = 0;
};

}  // namespace leandoc::linux_host
