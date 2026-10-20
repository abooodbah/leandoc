#include "LinuxApp.h"

#include <gio/gdesktopappinfo.h>
#include <gio/gio.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <optional>
#include <string_view>
#include <utility>

#include "Timing.h"
#include "core/Links.h"

namespace leandoc::linux_host {
namespace {

constexpr char kScheme[] = "leandoc";
constexpr char kAppHost[] = "app";
constexpr char kAppOrigin[] = "leandoc://app";
constexpr char kReaderUrl[] = "leandoc://app/reader.html";
constexpr char kPackagePrefix[] = "leandoc://app/pkg/";
constexpr char kSelfDesktopId[] = "io.github.abooodbah.leandoc.desktop";
constexpr char kDocxContentType[] =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
constexpr std::uint64_t kMaximumAssetBytes = 64ull * 1024ull * 1024ull;
constexpr std::size_t kMaximumMessageBytes = 65536;
constexpr std::size_t kMaximumRecent = 10;
constexpr std::size_t kMaximumTabs = 64;

#ifndef LEANDOC_INSTALL_ASSETS_DIR
#define LEANDOC_INSTALL_ASSETS_DIR "/usr/share/leandoc/assets"
#endif

#ifndef LEANDOC_VERSION
#define LEANDOC_VERSION "0.0.0"
#endif

std::string LowercaseAscii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](char character) {
        return character >= 'A' && character <= 'Z'
                   ? static_cast<char>(character - 'A' + 'a')
                   : character;
    });
    return value;
}

bool ParseUnsigned(std::string_view text, unsigned& value) {
    if (text.empty() || text.size() > 9 || text.front() == '0') {
        return false;
    }
    unsigned parsed = 0;
    const auto result = std::from_chars(text.data(), text.data() + text.size(), parsed);
    if (result.ec != std::errc() || result.ptr != text.data() + text.size()) {
        return false;
    }
    value = parsed;
    return true;
}

std::filesystem::path ResolveAssetRoot() {
    const char* overridePath = g_getenv("LEANDOC_ASSETS_DIR");
    if (overridePath != nullptr && overridePath[0] != '\0') {
        return std::filesystem::path(overridePath);
    }
    const std::filesystem::path installed(LEANDOC_INSTALL_ASSETS_DIR);
    std::error_code error;
    if (std::filesystem::is_regular_file(installed / "reader.html", error)) {
        return installed;
    }
    error.clear();
    const auto executable = std::filesystem::read_symlink("/proc/self/exe", error);
    if (!error) {
        const auto adjacent =
            executable.parent_path().parent_path() / "share" / "leandoc" / "assets";
        if (std::filesystem::is_regular_file(adjacent / "reader.html", error)) {
            return adjacent;
        }
    }
    return installed;
}

std::string DisplayName(const std::filesystem::path& path) {
    if (path.empty()) {
        return {};
    }
    char* display = g_filename_display_name(path.c_str());
    if (display == nullptr) {
        return path.string();
    }
    std::string result(display);
    g_free(display);
    return result;
}

std::filesystem::path CanonicalPath(const std::filesystem::path& path) {
    std::error_code error;
    const auto absolute = std::filesystem::absolute(path, error);
    if (error) {
        return path;
    }
    const auto canonical = std::filesystem::weakly_canonical(absolute, error);
    return error ? absolute.lexically_normal() : canonical;
}

std::filesystem::path SettingsFilePath() {
    return std::filesystem::path(g_get_user_config_dir()) / "leandoc" / "settings.ini";
}

std::optional<const char*> AssetContentType(const std::filesystem::path& path) {
    const std::string extension = LowercaseAscii(path.extension().string());
    static constexpr std::array<std::pair<std::string_view, const char*>, 10> kTypes = {{
        {".html", "text/html"},
        {".css", "text/css"},
        {".js", "text/javascript"},
        {".mjs", "text/javascript"},
        {".json", "application/json"},
        {".woff2", "font/woff2"},
        {".woff", "font/woff"},
        {".ttf", "font/ttf"},
        {".svg", "image/svg+xml"},
        {".png", "image/png"},
    }};
    for (const auto& [suffix, type] : kTypes) {
        if (extension == suffix) {
            return type;
        }
    }
    return std::nullopt;
}

// Answers a scheme request with a status and an optional body. Every answer
// carries no-store and nosniff, so nothing is cached or reinterpreted. WebKit
// treats fetch() and fonts on a custom scheme as CORS requests, so each answer
// names the app origin itself, never "*", as the one allowed origin.
void FinishResponse(
    WebKitURISchemeRequest* request,
    GInputStream* stream,
    gint64 length,
    guint status,
    const char* contentType) {
    GInputStream* body = stream;
    if (body == nullptr) {
        body = g_memory_input_stream_new();
        length = 0;
    } else {
        g_object_ref(body);
    }
    WebKitURISchemeResponse* response = webkit_uri_scheme_response_new(body, length);
    g_object_unref(body);
    webkit_uri_scheme_response_set_status(response, status, nullptr);
    if (contentType != nullptr) {
        webkit_uri_scheme_response_set_content_type(response, contentType);
    }
    SoupMessageHeaders* headers = soup_message_headers_new(SOUP_MESSAGE_HEADERS_RESPONSE);
    soup_message_headers_append(headers, "Cache-Control", "no-store");
    soup_message_headers_append(headers, "X-Content-Type-Options", "nosniff");
    soup_message_headers_append(headers, "Access-Control-Allow-Origin", kAppOrigin);
    if (contentType != nullptr) {
        // Headers replace the response's own type, so it is repeated here.
        soup_message_headers_append(headers, "Content-Type", contentType);
    }
    webkit_uri_scheme_response_set_http_headers(response, headers);
    webkit_uri_scheme_request_finish_with_response(request, response);
    g_object_unref(response);
}

void FinishNotFound(WebKitURISchemeRequest* request) {
    FinishResponse(request, nullptr, 0, 404, "text/plain");
}

// Splits leandoc://app/<path> into its decoded path, rejecting other origins,
// NUL bytes, backslashes, and dot segments.
bool DecodeAppPath(const char* uri, std::string& decodedPath) {
    if (uri == nullptr || LowercaseAscii(uri).find("%00") != std::string::npos) {
        return false;
    }
    GError* error = nullptr;
    GUri* parsed = g_uri_parse(uri, G_URI_FLAGS_NONE, &error);
    if (parsed == nullptr) {
        g_clear_error(&error);
        return false;
    }
    const char* scheme = g_uri_get_scheme(parsed);
    const char* host = g_uri_get_host(parsed);
    const char* path = g_uri_get_path(parsed);
    const bool originMatches =
        scheme != nullptr && host != nullptr && path != nullptr &&
        g_ascii_strcasecmp(scheme, kScheme) == 0 &&
        g_ascii_strcasecmp(host, kAppHost) == 0 && g_uri_get_port(parsed) == -1;
    if (!originMatches) {
        g_uri_unref(parsed);
        return false;
    }
    char* decoded = g_uri_unescape_string(path, nullptr);
    g_uri_unref(parsed);
    if (decoded == nullptr) {
        return false;
    }
    decodedPath = decoded;
    g_free(decoded);
    if (decodedPath.empty() || decodedPath.front() != '/' ||
        decodedPath.find('\\') != std::string::npos) {
        return false;
    }
    std::size_t start = 1;
    while (start <= decodedPath.size()) {
        const std::size_t end = decodedPath.find('/', start);
        const std::string_view segment = std::string_view(decodedPath).substr(
            start, end == std::string::npos ? std::string::npos : end - start);
        if (segment == "." || segment == "..") {
            return false;
        }
        if (end == std::string::npos) {
            break;
        }
        start = end + 1;
    }
    return true;
}

// Reads one string property of a reader message, bounded in length.
std::optional<std::string> StringProperty(JSCValue* object, const char* name) {
    JSCValue* value = jsc_value_object_get_property(object, name);
    std::optional<std::string> result;
    if (value != nullptr && jsc_value_is_string(value)) {
        char* text = jsc_value_to_string(value);
        if (text != nullptr) {
            std::string copied(text);
            if (copied.size() <= 32768) {
                result = std::move(copied);
            }
            g_free(text);
        }
    }
    g_clear_object(&value);
    return result;
}

std::optional<unsigned> UnsignedProperty(JSCValue* object, const char* name) {
    JSCValue* value = jsc_value_object_get_property(object, name);
    std::optional<unsigned> result;
    if (value != nullptr && jsc_value_is_number(value)) {
        const double number = jsc_value_to_double(value);
        if (number >= 0 && number <= 4294967295.0 &&
            number == static_cast<double>(static_cast<unsigned>(number))) {
            result = static_cast<unsigned>(number);
        }
    }
    g_clear_object(&value);
    return result;
}

void AppendJson(std::string& json, std::string_view value) {
    core::AppendJsonString(json, value);
}

// Measured once at the first open: the reader asks for the label in "host".
EditorCandidates DiscoverEditors() {
    EditorCandidates candidates;
    for (const char* program : {"libreoffice", "soffice"}) {
        char* found = g_find_program_in_path(program);
        if (found != nullptr) {
            candidates.libreOffice = found;
            g_free(found);
            break;
        }
    }
    if (candidates.libreOffice.empty()) {
        GDesktopAppInfo* writer = g_desktop_app_info_new("libreoffice-writer.desktop");
        if (writer != nullptr) {
            candidates.libreOffice = "libreoffice-writer.desktop";
            candidates.libreOfficeIsDesktopId = true;
            g_object_unref(writer);
        }
    }
    GAppInfo* fallback = g_app_info_get_default_for_type(kDocxContentType, FALSE);
    if (fallback != nullptr) {
        const char* id = g_app_info_get_id(fallback);
        if (id != nullptr) {
            candidates.defaultApp = id;
            candidates.defaultIsSelf = g_strcmp0(id, kSelfDesktopId) == 0;
            const char* name = g_app_info_get_display_name(fallback);
            candidates.defaultAppName = name == nullptr ? "" : name;
        }
        g_object_unref(fallback);
    }
    return candidates;
}

}  // namespace

LinuxApp* LinuxApp::Create(
    GtkApplication* application,
    const HostOptions& options,
    int* smokeExitCode) {
    auto* instance = new LinuxApp(application, options, smokeExitCode);
    instance->Initialize();
    return instance;
}

LinuxApp::LinuxApp(
    GtkApplication* application, const HostOptions& options, int* smokeExitCode)
    : application_(application),
      assetRoot_(ResolveAssetRoot()),
      smokeTest_(options.smokeTest),
      exitAfterRenderMs_(options.exitAfterRenderMs),
      smokeExitCode_(smokeExitCode),
      testScript_(options.testScript) {}

LinuxApp::~LinuxApp() {
    if (reloadTimer_ != 0) {
        g_source_remove(reloadTimer_);
    }
    if (smokeTimeout_ != 0) {
        g_source_remove(smokeTimeout_);
    }
    if (exitTimer_ != 0) {
        g_source_remove(exitTimer_);
    }
    if (scriptTimer_ != 0) {
        g_source_remove(scriptTimer_);
    }
    if (scriptDeadline_ != 0) {
        g_source_remove(scriptDeadline_);
    }
    if (scriptCancel_ != nullptr) {
        // Pending script reads and evaluations finish as cancelled and never
        // touch this object again.
        g_cancellable_cancel(scriptCancel_);
        g_clear_object(&scriptCancel_);
    }
    g_clear_object(&scriptStream_);
    ClearPackage();
    g_clear_object(&directoryMonitor_);
    g_clear_object(&contentManager_);
    g_clear_object(&networkSession_);
    g_clear_object(&webContext_);
}

void LinuxApp::Initialize() {
    LoadSettings();
    ResolveEditor();

    window_ = gtk_application_window_new(application_);
    gtk_window_set_default_size(GTK_WINDOW(window_), 1120, 820);
    gtk_widget_set_size_request(window_, 640, 480);
    g_object_weak_ref(G_OBJECT(window_), OnWindowFinalized, this);
    if (TimingEnabled()) {
        g_signal_connect(window_, "map", G_CALLBACK(OnWindowMapped), this);
    }
    UpdateTitle();

    // Dropped files open as tabs. The capture phase sees the drop before the
    // web view, which would otherwise try to navigate to the file.
    GtkDropTarget* drop = gtk_drop_target_new(GDK_TYPE_FILE_LIST, GDK_ACTION_COPY);
    gtk_event_controller_set_propagation_phase(
        GTK_EVENT_CONTROLLER(drop), GTK_PHASE_CAPTURE);
    g_signal_connect(drop, "drop", G_CALLBACK(OnDrop), this);
    gtk_widget_add_controller(window_, GTK_EVENT_CONTROLLER(drop));

    webContext_ = webkit_web_context_new();
    webkit_web_context_set_cache_model(webContext_, WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER);
    webkit_web_context_register_uri_scheme(webContext_, kScheme, OnScheme, this, nullptr);
    WebKitSecurityManager* security = webkit_web_context_get_security_manager(webContext_);
    webkit_security_manager_register_uri_scheme_as_local(security, kScheme);
    webkit_security_manager_register_uri_scheme_as_secure(security, kScheme);

    networkSession_ = webkit_network_session_new_ephemeral();
    contentManager_ = webkit_user_content_manager_new();
    g_signal_connect(
        contentManager_, "script-message-received::leandoc",
        G_CALLBACK(OnScriptMessage), this);
    if (!webkit_user_content_manager_register_script_message_handler(
            contentManager_, "leandoc", nullptr)) {
        g_warning("LeanDoc could not register its WebKit message handler.");
    }
    if (smokeTest_) {
        smokeTimeout_ = g_timeout_add_seconds(18, OnSmokeTimeout, this);
        // The smoke check counts Content Security Policy violations from the
        // first script onwards.
        WebKitUserScript* probe = webkit_user_script_new(
            "window.__leandocCspViolations = 0;"
            "document.addEventListener('securitypolicyviolation', function () {"
            "  window.__leandocCspViolations += 1; });",
            WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
            WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
            nullptr, nullptr);
        webkit_user_content_manager_add_script(contentManager_, probe);
        webkit_user_script_unref(probe);
    }

    WebKitSettings* settings = webkit_settings_new();
    webkit_settings_set_enable_javascript(settings, TRUE);
    webkit_settings_set_enable_developer_extras(settings, FALSE);
    webkit_settings_set_javascript_can_open_windows_automatically(settings, FALSE);
    webkit_settings_set_allow_file_access_from_file_urls(settings, FALSE);
    webkit_settings_set_allow_universal_access_from_file_urls(settings, FALSE);
    webkit_settings_set_enable_html5_local_storage(settings, FALSE);
    webkit_settings_set_enable_html5_database(settings, FALSE);
    webkit_settings_set_enable_page_cache(settings, FALSE);
    webkit_settings_set_enable_webgl(settings, FALSE);
    webkit_settings_set_enable_webaudio(settings, FALSE);
    webkit_settings_set_enable_media(settings, FALSE);
    // The smoke test prints reader console messages, which CI logs keep.
    webkit_settings_set_enable_write_console_messages_to_stdout(settings, smokeTest_);

    webView_ = WEBKIT_WEB_VIEW(g_object_new(
        WEBKIT_TYPE_WEB_VIEW,
        "web-context", webContext_,
        "network-session", networkSession_,
        "user-content-manager", contentManager_,
        "settings", settings,
        nullptr));
    g_object_unref(settings);

    ConfigureWebView();
    ApplyWindowTheme();
    gtk_window_set_child(GTK_WINDOW(window_), GTK_WIDGET(webView_));
    NavigateToReader();
    gtk_window_present(GTK_WINDOW(window_));
}

void LinuxApp::ConfigureWebView() {
    g_signal_connect(webView_, "decide-policy", G_CALLBACK(OnDecidePolicy), this);
    g_signal_connect(webView_, "create", G_CALLBACK(OnCreateWebView), this);
    g_signal_connect(webView_, "permission-request", G_CALLBACK(OnPermissionRequest), this);
    g_signal_connect(
        webView_, "query-permission-state", G_CALLBACK(OnQueryPermissionState), this);
    g_signal_connect(
        networkSession_, "download-started", G_CALLBACK(OnDownloadStarted), this);
    g_signal_connect(webView_, "script-dialog", G_CALLBACK(OnScriptDialog), this);
    g_signal_connect(webView_, "run-file-chooser", G_CALLBACK(OnRunFileChooser), this);
    g_signal_connect(webView_, "enter-fullscreen", G_CALLBACK(OnEnterFullscreen), this);
    g_signal_connect(webView_, "print", G_CALLBACK(OnPrint), this);
    g_signal_connect(
        webView_, "web-process-terminated", G_CALLBACK(OnWebProcessTerminated), this);
    g_signal_connect(webView_, "context-menu", G_CALLBACK(OnContextMenu), this);
}

void LinuxApp::NavigateToReader() {
    readerReady_ = false;
    webkit_web_view_load_uri(webView_, kReaderUrl);
}

void LinuxApp::ResolveEditor() {
    editor_ = ChooseEditor(DiscoverEditors());
}

void LinuxApp::Present() {
    if (window_ != nullptr) {
        gtk_window_present(GTK_WINDOW(window_));
    }
}

LinuxApp::Tab* LinuxApp::FindTab(unsigned id) {
    const auto found = std::find_if(
        tabs_.begin(), tabs_.end(), [id](const Tab& tab) { return tab.id == id; });
    return found == tabs_.end() ? nullptr : &*found;
}

LinuxApp::Tab* LinuxApp::ActiveTab() {
    return activeTab_ == 0 ? nullptr : FindTab(activeTab_);
}

void LinuxApp::OpenPaths(const std::vector<std::filesystem::path>& paths) {
    // Tabs are created from paths alone. Only the tab that ends up active is
    // read, so opening twenty files costs one render.
    unsigned selected = 0;
    for (const auto& requested : paths) {
        if (requested.empty()) {
            continue;
        }
        const std::filesystem::path path = CanonicalPath(requested);
        const auto existing = std::find_if(
            tabs_.begin(), tabs_.end(), [&path](const Tab& tab) { return tab.path == path; });
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
        tab.name = DisplayName(path.filename());
        tabs_.push_back(std::move(tab));
        selected = tabs_.back().id;
    }
    if (selected != 0) {
        ActivateTab(selected);
    }
}

void LinuxApp::ActivateTab(unsigned id) {
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

void LinuxApp::CloseTab(unsigned id) {
    const auto found = std::find_if(
        tabs_.begin(), tabs_.end(), [id](const Tab& tab) { return tab.id == id; });
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

void LinuxApp::ClearPackage() {
    if (package_ != nullptr) {
        g_bytes_unref(package_);
        package_ = nullptr;
    }
    packageTab_ = 0;
    packageGeneration_ = 0;
}

void LinuxApp::ShowActiveTab(bool automaticReload) {
    Tab* tab = ActiveTab();
    if (tab == nullptr) {
        ClearPackage();
        g_clear_object(&directoryMonitor_);
        UpdateTitle();
        SendEmpty();
        return;
    }

    if (tab->rendererStopped) {
        ClearPackage();
        UpdateTitle();
        std::string json = "{\"type\":\"fallback\",\"tab\":";
        json += std::to_string(tab->id);
        json += ",\"generation\":";
        json += std::to_string(tab->generation);
        json += ",\"fileName\":\"";
        AppendJson(json, tab->name);
        json += "\",\"displayPath\":\"";
        AppendJson(json, DisplayName(tab->path));
        json += "\",\"report\":{\"ok\":false,\"kind\":\"docx\",\"errorCode\":"
                "\"renderer-stopped\",\"errorMessage\":\"\",\"features\":[],\"outline\":[]}}";
        SendJson(json);
        return;
    }

    if (TimingEnabled()) {
        TraceTiming(
            "document-requested",
            "tab=" + std::to_string(tab->id) +
                " generation=" + std::to_string(tab->generation + 1));
    }
    const auto coreStart = std::chrono::steady_clock::now();
    core::OpenResult result = core::OpenDocumentFile(tab->path);
    lastCoreMs_ = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - coreStart)
            .count());
    if (automaticReload && !result.ok && result.errorCode == "read-failed") {
        SendStatus(
            "The file is still changing or cannot be read. Keeping the last "
            "complete view.",
            "warning");
        return;
    }

    ++tab->generation;
    tab->shown = true;
    WatchActiveTab();
    UpdateTitle();
    if (!smokeTest_) {
        AddRecent(tab->path);
    }

    const std::string report = core::ReportToJson(result);
    const std::string displayPath = DisplayName(tab->path);
    std::string json;
    json.reserve(report.size() + 512);
    const bool renderable = result.ok && core::IsRenderableKind(result.kind) &&
                            !result.sanitizedPackage.empty();
    if (renderable) {
        ClearPackage();
        auto* owned = new std::string(std::move(result.sanitizedPackage));
        package_ = g_bytes_new_with_free_func(
            owned->data(), owned->size(),
            [](gpointer data) { delete static_cast<std::string*>(data); }, owned);
        packageTab_ = tab->id;
        packageGeneration_ = tab->generation;

        json += "{\"type\":\"document\",\"tab\":";
        json += std::to_string(tab->id);
        json += ",\"generation\":";
        json += std::to_string(tab->generation);
        json += ",\"fileName\":\"";
        AppendJson(json, tab->name);
        json += "\",\"displayPath\":\"";
        AppendJson(json, displayPath);
        json += "\",\"packageUrl\":\"";
        json += kPackagePrefix;
        json += std::to_string(tab->id) + "/" + std::to_string(tab->generation);
        json += "/document.docx\",\"report\":";
        json += report;
        json += '}';
    } else {
        ClearPackage();
        json += "{\"type\":\"fallback\",\"tab\":";
        json += std::to_string(tab->id);
        json += ",\"generation\":";
        json += std::to_string(tab->generation);
        json += ",\"fileName\":\"";
        AppendJson(json, tab->name);
        json += "\",\"displayPath\":\"";
        AppendJson(json, displayPath);
        json += "\",\"report\":";
        json += report;
        json += '}';
        if (smokeTest_) {
            CompleteSmoke(false, "The smoke fixture did not produce a renderable package.");
            return;
        }
    }
    SendJson(json);
}

void LinuxApp::WatchActiveTab() {
    if (reloadTimer_ != 0) {
        g_source_remove(reloadTimer_);
        reloadTimer_ = 0;
    }
    g_clear_object(&directoryMonitor_);
    const Tab* tab = ActiveTab();
    if (tab == nullptr || smokeTest_) {
        return;
    }
    GFile* directory = g_file_new_for_path(tab->path.parent_path().c_str());
    GError* error = nullptr;
    directoryMonitor_ =
        g_file_monitor_directory(directory, G_FILE_MONITOR_WATCH_MOVES, nullptr, &error);
    g_object_unref(directory);
    if (directoryMonitor_ == nullptr) {
        g_clear_error(&error);
        return;
    }
    g_signal_connect(directoryMonitor_, "changed", G_CALLBACK(OnDirectoryChanged), this);
}

void LinuxApp::ScheduleReload() {
    if (reloadTimer_ != 0) {
        g_source_remove(reloadTimer_);
    }
    reloadTimer_ = g_timeout_add(350, OnReloadTimer, this);
}

void LinuxApp::OpenDocumentDialog() {
    GtkFileDialog* dialog = gtk_file_dialog_new();
    gtk_file_dialog_set_title(dialog, "Open documents");

    GtkFileFilter* documents = gtk_file_filter_new();
    gtk_file_filter_set_name(documents, "Word documents");
    for (const char* pattern :
         {"*.docx", "*.dotx", "*.docm", "*.dotm", "*.doc", "*.rtf", "*.odt",
          "*.DOCX", "*.DOTX", "*.DOCM", "*.DOTM", "*.DOC", "*.RTF", "*.ODT"}) {
        gtk_file_filter_add_pattern(documents, pattern);
    }
    GtkFileFilter* allFiles = gtk_file_filter_new();
    gtk_file_filter_set_name(allFiles, "All files");
    gtk_file_filter_add_pattern(allFiles, "*");

    GListStore* filters = g_list_store_new(GTK_TYPE_FILE_FILTER);
    g_list_store_append(filters, documents);
    g_list_store_append(filters, allFiles);
    gtk_file_dialog_set_filters(dialog, G_LIST_MODEL(filters));
    gtk_file_dialog_set_default_filter(dialog, documents);
    g_object_unref(documents);
    g_object_unref(allFiles);
    g_object_unref(filters);

    g_object_set_data(G_OBJECT(window_), "leandoc-app", this);
    gtk_file_dialog_open_multiple(
        dialog, GTK_WINDOW(window_), nullptr, OnOpenDialogFinished, g_object_ref(window_));
}

void LinuxApp::OpenInEditor(unsigned tabId) {
    const Tab* tab = FindTab(tabId);
    if (tab == nullptr) {
        tab = ActiveTab();
    }
    if (tab == nullptr) {
        return;
    }
    LaunchEditor(tab->path);
}

void LinuxApp::LaunchEditor(const std::filesystem::path& path) {
    GError* error = nullptr;
    bool launched = false;
    if (editor_.kind == EditorKind::Web) {
        launched = g_app_info_launch_default_for_uri(editor_.target.c_str(), nullptr, &error);
        g_clear_error(&error);
        if (launched) {
            SendStatus(
                "Word for the web opened in your browser. Upload the file there to "
                "read or edit it.",
                "info");
        } else {
            SendStatus("Linux could not open the browser.", "error");
        }
        return;
    }

    if (editor_.targetIsDesktopId) {
        GDesktopAppInfo* info = g_desktop_app_info_new(editor_.target.c_str());
        if (info != nullptr) {
            GFile* file = g_file_new_for_path(path.c_str());
            GList* files = g_list_append(nullptr, file);
            GdkAppLaunchContext* context =
                gdk_display_get_app_launch_context(gtk_widget_get_display(window_));
            launched = g_app_info_launch(
                G_APP_INFO(info), files, G_APP_LAUNCH_CONTEXT(context), &error);
            g_object_unref(context);
            g_list_free(files);
            g_object_unref(file);
            g_object_unref(info);
        }
    } else {
        // An argument vector, never a shell string. The path is absolute, so
        // it can never be read as an option.
        const char* argv[] = {editor_.target.c_str(), path.c_str(), nullptr};
        GSubprocess* process = g_subprocess_newv(argv, G_SUBPROCESS_FLAGS_NONE, &error);
        launched = process != nullptr;
        g_clear_object(&process);
    }
    g_clear_error(&error);
    if (!launched) {
        SendStatus("LeanDoc could not start the editor.", "error");
    }
}

void LinuxApp::HandleLink(std::string_view hrefView) {
    // The same rule as every host (src/core/Links.h): http and https with a
    // host, and mailto with only its addresses, subject, body, cc, and bcc.
    const auto href = core::NormalizeExternalLink(hrefView);
    if (!href) {
        SendStatus("LeanDoc opens web and email links only.", "warning");
        return;
    }
    GError* error = nullptr;
    if (!g_app_info_launch_default_for_uri(href->c_str(), nullptr, &error)) {
        g_clear_error(&error);
        SendStatus("Linux could not open that link.", "error");
    }
}

void LinuxApp::HandleMessage(JSCValue* message) {
    const auto type = StringProperty(message, "type");
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
        if (testScript_ && !scriptStarted_) {
            StartTestScript();
        }
        return;
    }
    if (!readerReady_) {
        return;
    }
    if (*type == "rendered" || *type == "renderFailed") {
        HandleRendered(message, *type == "renderFailed");
    } else if (*type == "open") {
        OpenDocumentDialog();
    } else if (*type == "openRecent") {
        const auto path = StringProperty(message, "path");
        if (path && std::find(recent_.begin(), recent_.end(), *path) != recent_.end()) {
            OpenPaths({std::filesystem::path(*path)});
        }
    } else if (*type == "clearRecent") {
        recent_.clear();
        SaveSettings();
        if (ActiveTab() == nullptr) {
            SendEmpty();
        }
    } else if (*type == "openInEditor") {
        OpenInEditor(UnsignedProperty(message, "tab").value_or(activeTab_));
    } else if (*type == "link") {
        if (const auto href = StringProperty(message, "href")) {
            HandleLink(*href);
        }
    } else if (*type == "setTheme") {
        const auto theme = StringProperty(message, "theme");
        if (theme && (*theme == "system" || *theme == "light" || *theme == "dark")) {
            theme_ = *theme == "light" ? ThemeMode::Light
                     : *theme == "dark" ? ThemeMode::Dark
                                        : ThemeMode::System;
            SaveSettings();
            ApplyWindowTheme();
            SendTheme();
        }
    } else if (*type == "setView") {
        const auto view = StringProperty(message, "view");
        if (view && (*view == "page" || *view == "reading")) {
            view_ = *view;
            SaveSettings();
        }
    } else if (*type == "selectTab") {
        if (const auto id = UnsignedProperty(message, "id"); id && *id != activeTab_) {
            ActivateTab(*id);
        }
    } else if (*type == "closeTab") {
        if (const auto id = UnsignedProperty(message, "id")) {
            CloseTab(*id);
        }
    } else if (*type == "reload") {
        if (Tab* tab = ActiveTab()) {
            // A reload asks for the document again, even after the renderer
            // stopped on it.
            tab->rendererStopped = false;
            ShowActiveTab(false);
        }
    }
}

void LinuxApp::HandleRendered(JSCValue* message, bool failed) {
    const auto tab = UnsignedProperty(message, "tab");
    const auto generation = UnsignedProperty(message, "generation");
    const Tab* active = ActiveTab();
    // A message for an older generation describes a view that is gone.
    if (!tab || !generation || active == nullptr || *tab != active->id ||
        *generation != active->generation) {
        return;
    }
    if (testScript_) {
        ++renderedCount_;
        lastRenderFailed_ = failed;
        lastRenderDetails_ =
            "{\"tab\":" + std::to_string(*tab) + ",\"generation\":" +
            std::to_string(*generation) + ",\"pages\":" +
            std::to_string(UnsignedProperty(message, "pages").value_or(0)) +
            ",\"readerMs\":" + std::to_string(UnsignedProperty(message, "ms").value_or(0)) +
            ",\"failed\":" + (failed ? "true" : "false") + "}";
        if (scriptWaitingRender_) {
            scriptWaitingRender_ = false;
            FinishScriptCommand(!failed, lastRenderDetails_);
        }
    }
    if (!failed) {
        if (TimingEnabled()) {
            TraceTiming(
                "rendered",
                "tab=" + std::to_string(*tab) + " generation=" + std::to_string(*generation) +
                    " pages=" + std::to_string(UnsignedProperty(message, "pages").value_or(0)) +
                    " readerMs=" + std::to_string(UnsignedProperty(message, "ms").value_or(0)));
        }
        if (exitAfterRenderMs_ && !firstRenderSeen_) {
            exitTimer_ = g_timeout_add(*exitAfterRenderMs_, OnExitAfterRender, this);
        }
        firstRenderSeen_ = true;
    }
    if (!smokeTest_) {
        return;
    }
    if (failed) {
        const auto reason = StringProperty(message, "message");
        CompleteSmoke(false, "The reader reported renderFailed: " + reason.value_or(""));
        return;
    }
    smokeRenderMs_ = UnsignedProperty(message, "ms").value_or(0);
    StartSmokeProbe();
}

void LinuxApp::SendJson(const std::string& json) {
    if (webView_ == nullptr || !readerReady_) {
        return;
    }
    // The JSON is a literal object, never a string that the page evaluates.
    static constexpr std::string_view kPrefix =
        "window.dispatchEvent(new CustomEvent(\"leandoc-message\",{detail:";
    std::string script;
    script.reserve(kPrefix.size() + json.size() + 8);
    script += kPrefix;
    script += json;
    script += "}));";
    webkit_web_view_evaluate_javascript(
        webView_, script.c_str(), static_cast<gssize>(script.size()), nullptr,
        kReaderUrl, nullptr, nullptr, nullptr);
}

void LinuxApp::SendHost() {
    std::string json = "{\"type\":\"host\",\"platform\":\"linux\",\"version\":\"";
    json += LEANDOC_VERSION;
    json += "\",\"editor\":{\"kind\":\"";
    json += EditorKindName(editor_.kind);
    json += "\",\"label\":\"";
    AppendJson(json, editor_.label);
    json += "\"},\"tabs\":true}";
    SendJson(json);
}

void LinuxApp::SendTheme() {
    SendJson(
        "{\"type\":\"theme\",\"theme\":\"" + ThemeName() + "\",\"view\":\"" + view_ + "\"}");
}

void LinuxApp::SendTabs() {
    std::string json = "{\"type\":\"tabs\",\"active\":";
    json += std::to_string(activeTab_);
    json += ",\"tabs\":[";
    for (std::size_t index = 0; index < tabs_.size(); ++index) {
        json += index == 0 ? "{\"id\":" : ",{\"id\":";
        json += std::to_string(tabs_[index].id);
        json += ",\"name\":\"";
        AppendJson(json, tabs_[index].name);
        json += "\",\"path\":\"";
        AppendJson(json, DisplayName(tabs_[index].path));
        json += "\"}";
    }
    json += "]}";
    SendJson(json);
}

void LinuxApp::SendEmpty() {
    std::string json = "{\"type\":\"empty\",\"recent\":[";
    for (std::size_t index = 0; index < recent_.size(); ++index) {
        json += index == 0 ? "{\"path\":\"" : ",{\"path\":\"";
        AppendJson(json, recent_[index]);
        json += "\",\"name\":\"";
        AppendJson(json, DisplayName(std::filesystem::path(recent_[index]).filename()));
        json += "\"}";
    }
    json += "]}";
    SendJson(json);
}

void LinuxApp::SendStatus(std::string_view message, std::string_view tone) {
    std::string json = "{\"type\":\"status\",\"message\":\"";
    AppendJson(json, message);
    json += "\",\"tone\":\"";
    AppendJson(json, tone);
    json += "\"}";
    SendJson(json);
}

void LinuxApp::LoadSettings() {
    GKeyFile* settings = g_key_file_new();
    if (!g_key_file_load_from_file(
            settings, SettingsFilePath().c_str(), G_KEY_FILE_NONE, nullptr)) {
        g_key_file_unref(settings);
        return;
    }
    if (char* theme = g_key_file_get_string(settings, "Reader", "Theme", nullptr)) {
        const std::string value = LowercaseAscii(theme);
        theme_ = value == "light" ? ThemeMode::Light
                 : value == "dark" ? ThemeMode::Dark
                                   : ThemeMode::System;
        g_free(theme);
    }
    if (char* view = g_key_file_get_string(settings, "Reader", "View", nullptr)) {
        view_ = g_strcmp0(view, "reading") == 0 ? "reading" : "page";
        g_free(view);
    }
    gsize count = 0;
    if (char** recent =
            g_key_file_get_string_list(settings, "Reader", "Recent", &count, nullptr)) {
        for (gsize index = 0; index < count && recent_.size() < kMaximumRecent; ++index) {
            if (recent[index][0] == '/') {
                recent_.emplace_back(recent[index]);
            }
        }
        g_strfreev(recent);
    }
    g_key_file_unref(settings);
}

void LinuxApp::SaveSettings() const {
    if (smokeTest_) {
        return;
    }
    const auto settingsPath = SettingsFilePath();
    if (g_mkdir_with_parents(settingsPath.parent_path().c_str(), 0700) != 0) {
        return;
    }
    GKeyFile* settings = g_key_file_new();
    g_key_file_set_string(settings, "Reader", "Theme", ThemeName().c_str());
    g_key_file_set_string(settings, "Reader", "View", view_.c_str());
    std::vector<const char*> recent;
    for (const auto& path : recent_) {
        recent.push_back(path.c_str());
    }
    g_key_file_set_string_list(settings, "Reader", "Recent", recent.data(), recent.size());
    gsize length = 0;
    char* data = g_key_file_to_data(settings, &length, nullptr);
    g_key_file_unref(settings);
    if (data != nullptr) {
        g_file_set_contents(settingsPath.c_str(), data, static_cast<gssize>(length), nullptr);
        g_free(data);
    }
}

void LinuxApp::AddRecent(const std::filesystem::path& path) {
    const std::string value = path.string();
    recent_.erase(std::remove(recent_.begin(), recent_.end(), value), recent_.end());
    recent_.insert(recent_.begin(), value);
    if (recent_.size() > kMaximumRecent) {
        recent_.resize(kMaximumRecent);
    }
    SaveSettings();
}

void LinuxApp::ApplyWindowTheme() {
    if (webView_ != nullptr) {
        const bool dark = theme_ == ThemeMode::Dark;
        GdkRGBA background = dark ? GdkRGBA{14 / 255.0f, 13 / 255.0f, 11 / 255.0f, 1.0f}
                                  : GdkRGBA{250 / 255.0f, 249 / 255.0f, 247 / 255.0f, 1.0f};
        webkit_web_view_set_background_color(webView_, &background);
    }
}

std::string LinuxApp::ThemeName() const {
    switch (theme_) {
        case ThemeMode::Light:
            return "light";
        case ThemeMode::Dark:
            return "dark";
        default:
            return "system";
    }
}

void LinuxApp::UpdateTitle() {
    if (window_ == nullptr) {
        return;
    }
    const Tab* tab = ActiveTab();
    const std::string title = tab == nullptr ? "LeanDoc" : tab->name + " - LeanDoc";
    gtk_window_set_title(GTK_WINDOW(window_), title.c_str());
}

// --test-script ---------------------------------------------------------------
// Commands run one at a time; each answers with one line on stdout (see
// TestHooks.h and docs/architecture/hosts.md). Nothing here runs unless the
// flag was given.

namespace {

struct ScriptJsCall {
    LinuxApp* app;
    unsigned line;
    bool poll;
};

std::string OneLine(std::string_view text) {
    std::string result(text);
    for (char& character : result) {
        if (character == '\n' || character == '\r') {
            character = ' ';
        }
    }
    return result;
}

}  // namespace

std::uint64_t LinuxApp::ScriptElapsedMs(std::chrono::steady_clock::time_point since) const {
    return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                          std::chrono::steady_clock::now() - since)
                                          .count());
}

void LinuxApp::StartTestScript() {
    scriptStarted_ = true;
    scriptCancel_ = g_cancellable_new();
    renderMarkStart_ = std::chrono::steady_clock::now();
    GFile* file = g_file_new_for_path(testScript_->c_str());
    // Opening a FIFO waits for its writer, so the open is asynchronous too.
    g_file_read_async(file, G_PRIORITY_DEFAULT, scriptCancel_, OnScriptOpened, this);
    g_object_unref(file);
}

void LinuxApp::OnScriptOpened(GObject* source, GAsyncResult* result, gpointer data) {
    GError* error = nullptr;
    GFileInputStream* stream = g_file_read_finish(G_FILE(source), result, &error);
    if (stream == nullptr) {
        const bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
        const std::string message = error != nullptr ? error->message : "unknown error";
        g_clear_error(&error);
        if (cancelled) {
            return;
        }
        auto* app = static_cast<LinuxApp*>(data);
        std::printf("LEANDOC_TEST 0 open-script error 0 %s\n", OneLine(message).c_str());
        std::fflush(stdout);
        app->scriptFailed_ = true;
        if (app->smokeExitCode_ != nullptr) {
            *app->smokeExitCode_ = 1;
        }
        g_application_quit(G_APPLICATION(app->application_));
        return;
    }
    auto* app = static_cast<LinuxApp*>(data);
    app->scriptStream_ = g_data_input_stream_new(G_INPUT_STREAM(stream));
    g_object_unref(stream);
    app->ReadNextScriptLine();
}

void LinuxApp::ReadNextScriptLine() {
    if (scriptStream_ == nullptr) {
        return;
    }
    g_data_input_stream_read_line_async(
        scriptStream_, G_PRIORITY_DEFAULT, scriptCancel_, OnScriptLine, this);
}

void LinuxApp::OnScriptLine(GObject* source, GAsyncResult* result, gpointer data) {
    GError* error = nullptr;
    gsize length = 0;
    char* line = g_data_input_stream_read_line_finish(
        G_DATA_INPUT_STREAM(source), result, &length, &error);
    if (error != nullptr) {
        const bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
        g_clear_error(&error);
        g_free(line);
        if (!cancelled) {
            auto* app = static_cast<LinuxApp*>(data);
            std::printf("LEANDOC_TEST %u read error 0\n", app->scriptLine_ + 1);
            std::fflush(stdout);
            app->scriptFailed_ = true;
        }
        return;
    }
    auto* app = static_cast<LinuxApp*>(data);
    if (line == nullptr) {
        // End of the script: the window stays as it is.
        std::printf("LEANDOC_TEST %u eof ok 0\n", app->scriptLine_ + 1);
        std::fflush(stdout);
        return;
    }
    const std::string text(line, length);
    g_free(line);
    app->RunScriptLine(text);
}

void LinuxApp::RunScriptLine(const std::string& line) {
    ++scriptLine_;
    scriptCommand_ = ParseScriptCommand(line);
    scriptCommandStart_ = std::chrono::steady_clock::now();
    const ScriptCommandKind kind = scriptCommand_.kind;
    const bool action = kind == ScriptCommandKind::Js || kind == ScriptCommandKind::Open ||
                        kind == ScriptCommandKind::Drop ||
                        kind == ScriptCommandKind::SystemTheme ||
                        kind == ScriptCommandKind::Resize;
    if (action) {
        // wait-render waits for a render that this action started.
        renderMark_ = renderedCount_;
        renderMarkStart_ = scriptCommandStart_;
    }
    switch (kind) {
        case ScriptCommandKind::Empty:
            --scriptLine_;
            ReadNextScriptLine();
            return;
        case ScriptCommandKind::Invalid:
            FinishScriptCommand(false, "unknown command or bad argument");
            return;
        case ScriptCommandKind::Js:
            EvaluateScriptJs(scriptCommand_.argument);
            return;
        case ScriptCommandKind::Wait:
            ArmScriptDeadline();
            PollScriptWait();
            return;
        case ScriptCommandKind::WaitRender:
            if (renderedCount_ > renderMark_) {
                renderMark_ = renderedCount_;
                FinishScriptCommand(!lastRenderFailed_, lastRenderDetails_);
                return;
            }
            scriptWaitingRender_ = true;
            ArmScriptDeadline();
            return;
        case ScriptCommandKind::Open:
            OpenPaths({std::filesystem::path(scriptCommand_.argument)});
            FinishScriptCommand(true, "");
            return;
        case ScriptCommandKind::Drop: {
            GFile* file = g_file_new_for_path(scriptCommand_.argument.c_str());
            GSList* files = g_slist_append(nullptr, file);
            GdkFileList* list = gdk_file_list_new_from_list(files);
            g_slist_free(files);
            g_object_unref(file);
            GValue value = G_VALUE_INIT;
            g_value_init(&value, GDK_TYPE_FILE_LIST);
            g_value_take_boxed(&value, list);
            const gboolean accepted = OnDrop(nullptr, &value, 0, 0, this);
            g_value_unset(&value);
            FinishScriptCommand(true, accepted ? "accepted" : "refused");
            return;
        }
        case ScriptCommandKind::Sleep:
            scriptTimer_ = g_timeout_add(scriptCommand_.number, OnScriptTimer, this);
            return;
        case ScriptCommandKind::Mark:
            FinishScriptCommand(true, scriptCommand_.argument);
            return;
        case ScriptCommandKind::Timeout:
            scriptTimeoutMs_ = std::max(1u, scriptCommand_.number);
            FinishScriptCommand(true, "");
            return;
        case ScriptCommandKind::SystemTheme:
            // Stands in for the desktop switching its colour scheme.
            g_object_set(
                gtk_settings_get_default(), "gtk-application-prefer-dark-theme",
                scriptCommand_.argument == "dark" ? TRUE : FALSE, nullptr);
            FinishScriptCommand(true, scriptCommand_.argument);
            return;
        case ScriptCommandKind::Resize:
            gtk_window_set_default_size(
                GTK_WINDOW(window_), static_cast<int>(scriptCommand_.number),
                static_cast<int>(scriptCommand_.secondNumber));
            FinishScriptCommand(true, "");
            return;
        case ScriptCommandKind::Quit:
            if (smokeExitCode_ != nullptr) {
                *smokeExitCode_ = scriptFailed_ ? 1 : 0;
            }
            std::printf("LEANDOC_TEST %u quit %s 0\n", scriptLine_, scriptFailed_ ? "error" : "ok");
            std::fflush(stdout);
            g_application_quit(G_APPLICATION(application_));
            return;
    }
}

void LinuxApp::EvaluateScriptJs(const std::string& body) {
    // The body runs as an async function in the reader page, so it can await
    // and return any JSON value.
    const std::string wrapped =
        "const __leandocResult = await (async () => {\n" + body +
        "\n})();\nreturn __leandocResult === undefined ? 'null' : "
        "JSON.stringify(__leandocResult);";
    auto* call = new ScriptJsCall{this, scriptLine_, false};
    webkit_web_view_call_async_javascript_function(
        webView_, wrapped.c_str(), static_cast<gssize>(wrapped.size()), nullptr, nullptr,
        nullptr, scriptCancel_, OnScriptJsFinished, call);
}

void LinuxApp::PollScriptWait() {
    const std::string body =
        "return (await (async () => (" + scriptCommand_.argument + "))()) ? 'true' : 'false';";
    auto* call = new ScriptJsCall{this, scriptLine_, true};
    webkit_web_view_call_async_javascript_function(
        webView_, body.c_str(), static_cast<gssize>(body.size()), nullptr, nullptr, nullptr,
        scriptCancel_, OnScriptJsFinished, call);
}

void LinuxApp::OnScriptJsFinished(GObject* source, GAsyncResult* result, gpointer data) {
    auto* call = static_cast<ScriptJsCall*>(data);
    GError* error = nullptr;
    JSCValue* value = webkit_web_view_call_async_javascript_function_finish(
        WEBKIT_WEB_VIEW(source), result, &error);
    const bool cancelled = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
    LinuxApp* app = cancelled ? nullptr : call->app;
    const unsigned line = call->line;
    const bool poll = call->poll;
    delete call;
    std::string text;
    if (value != nullptr && jsc_value_is_string(value)) {
        char* raw = jsc_value_to_string(value);
        text = raw == nullptr ? "" : raw;
        g_free(raw);
    }
    const std::string message = error != nullptr ? error->message : "";
    g_clear_object(&value);
    g_clear_error(&error);
    // A late answer for a command that already timed out is dropped.
    if (app == nullptr || line != app->scriptLine_ || app->scriptCommand_.kind ==
                                                          ScriptCommandKind::Empty) {
        return;
    }
    if (!poll) {
        if (!message.empty()) {
            app->FinishScriptCommand(false, message);
        } else {
            app->FinishScriptCommand(true, text);
        }
        return;
    }
    if (app->scriptDeadline_ == 0) {
        return;  // The wait already ended.
    }
    if (text == "true") {
        app->FinishScriptCommand(true, "");
        return;
    }
    // Not yet (or the page is reloading): ask again shortly.
    app->scriptTimer_ = g_timeout_add(25, OnScriptTimer, app);
}

gboolean LinuxApp::OnScriptTimer(gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    app->scriptTimer_ = 0;
    if (app->scriptCommand_.kind == ScriptCommandKind::Sleep) {
        app->FinishScriptCommand(true, "");
    } else if (app->scriptCommand_.kind == ScriptCommandKind::Wait) {
        app->PollScriptWait();
    }
    return G_SOURCE_REMOVE;
}

void LinuxApp::ArmScriptDeadline() {
    if (scriptDeadline_ != 0) {
        g_source_remove(scriptDeadline_);
    }
    scriptDeadline_ = g_timeout_add(scriptTimeoutMs_, OnScriptDeadline, this);
}

gboolean LinuxApp::OnScriptDeadline(gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    app->scriptDeadline_ = 0;
    app->scriptWaitingRender_ = false;
    if (app->scriptTimer_ != 0) {
        g_source_remove(app->scriptTimer_);
        app->scriptTimer_ = 0;
    }
    app->FinishScriptCommand(false, "timed out");
    return G_SOURCE_REMOVE;
}

void LinuxApp::FinishScriptCommand(bool ok, std::string_view result) {
    if (scriptDeadline_ != 0) {
        g_source_remove(scriptDeadline_);
        scriptDeadline_ = 0;
    }
    if (scriptTimer_ != 0) {
        g_source_remove(scriptTimer_);
        scriptTimer_ = 0;
    }
    const auto since = scriptCommand_.kind == ScriptCommandKind::WaitRender
                           ? renderMarkStart_
                           : scriptCommandStart_;
    if (scriptCommand_.kind == ScriptCommandKind::WaitRender) {
        renderMark_ = renderedCount_;
    }
    if (!ok) {
        scriptFailed_ = true;
    }
    const std::string name = scriptCommand_.name.empty() ? "-" : scriptCommand_.name;
    std::printf("LEANDOC_TEST %u %s %s %llu%s%s\n", scriptLine_, name.c_str(),
                ok ? "ok" : "error", static_cast<unsigned long long>(ScriptElapsedMs(since)),
                result.empty() ? "" : " ", OneLine(result).c_str());
    std::fflush(stdout);
    scriptCommand_ = ScriptCommand{};
    ReadNextScriptLine();
}

void LinuxApp::StartSmokeProbe() {
    if (smokeComplete_ || smokeProbeStarted_) {
        return;
    }
    smokeProbeStarted_ = true;
    // The probe checks that a page exists in the DOM, that it has text, that no
    // resource was loaded from outside the app origin, and that the Content
    // Security Policy reported nothing.
    static constexpr char kProbe[] = R"JS(
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
    webkit_web_view_evaluate_javascript(
        webView_, kProbe, -1, nullptr, kReaderUrl, nullptr, OnSmokeProbeFinished, this);
}

void LinuxApp::CompleteSmoke(bool success, std::string_view reason) {
    if (smokeComplete_) {
        return;
    }
    smokeComplete_ = true;
    if (smokeTimeout_ != 0) {
        g_source_remove(smokeTimeout_);
        smokeTimeout_ = 0;
    }
    if (smokeExitCode_ != nullptr) {
        *smokeExitCode_ = success ? 0 : 1;
    }
    g_print("LeanDoc Linux smoke: %s: %.*s\n", success ? "PASS" : "FAIL",
            static_cast<int>(reason.size()), reason.data());
    g_application_quit(G_APPLICATION(application_));
}

void LinuxApp::HandleScheme(WebKitURISchemeRequest* request) {
    if (webkit_uri_scheme_request_get_web_view(request) != webView_) {
        FinishNotFound(request);
        return;
    }
    const char* method = webkit_uri_scheme_request_get_http_method(request);
    std::string path;
    if ((method != nullptr && g_strcmp0(method, "GET") != 0) ||
        !DecodeAppPath(webkit_uri_scheme_request_get_uri(request), path)) {
        FinishNotFound(request);
        return;
    }
    if (path.rfind("/pkg/", 0) == 0) {
        ServePackage(request, std::string_view(path).substr(5));
        return;
    }
    ServeAsset(request, std::string_view(path).substr(1));
}

void LinuxApp::ServePackage(WebKitURISchemeRequest* request, std::string_view path) {
    // <tab>/<generation>/document.docx, for the active tab's current package
    // only. Anything else, including an older generation, is not found.
    const std::size_t first = path.find('/');
    const std::size_t second = first == std::string_view::npos
                                   ? std::string_view::npos
                                   : path.find('/', first + 1);
    unsigned tab = 0;
    unsigned generation = 0;
    if (second == std::string_view::npos ||
        !ParseUnsigned(path.substr(0, first), tab) ||
        !ParseUnsigned(path.substr(first + 1, second - first - 1), generation) ||
        path.substr(second + 1) != "document.docx" || package_ == nullptr ||
        tab != packageTab_ || generation != packageGeneration_ || tab != activeTab_) {
        FinishNotFound(request);
        return;
    }
    if (TimingEnabled()) {
        TraceTiming(
            "package-served",
            "tab=" + std::to_string(tab) + " generation=" + std::to_string(generation) +
                " coreMs=" + std::to_string(lastCoreMs_) +
                " bytes=" + std::to_string(g_bytes_get_size(package_)));
    }
    GInputStream* stream = g_memory_input_stream_new_from_bytes(package_);
    FinishResponse(
        request, stream, static_cast<gint64>(g_bytes_get_size(package_)), 200,
        kDocxContentType);
    g_object_unref(stream);
}

void LinuxApp::ServeAsset(WebKitURISchemeRequest* request, std::string_view relativePath) {
    const std::filesystem::path relative{std::string(relativePath)};
    const auto contentType = AssetContentType(relative);
    const std::filesystem::path candidate = assetRoot_ / relative;
    std::error_code error;
    if (relativePath.empty() || relative.is_absolute() || !contentType ||
        !core::IsPathWithin(assetRoot_, candidate) ||
        !std::filesystem::is_regular_file(candidate, error) || error) {
        FinishNotFound(request);
        return;
    }
    const auto size = std::filesystem::file_size(candidate, error);
    if (error || size > kMaximumAssetBytes) {
        FinishNotFound(request);
        return;
    }
    GFile* file = g_file_new_for_path(candidate.c_str());
    GFileInputStream* stream = g_file_read(file, nullptr, nullptr);
    g_object_unref(file);
    if (stream == nullptr) {
        FinishNotFound(request);
        return;
    }
    FinishResponse(request, G_INPUT_STREAM(stream), static_cast<gint64>(size), 200, *contentType);
    g_object_unref(stream);
}

void LinuxApp::OnWindowFinalized(gpointer data, GObject*) {
    auto* app = static_cast<LinuxApp*>(data);
    app->window_ = nullptr;
    app->webView_ = nullptr;
    delete app;
}

void LinuxApp::OnScheme(WebKitURISchemeRequest* request, gpointer data) {
    static_cast<LinuxApp*>(data)->HandleScheme(request);
}

void LinuxApp::OnScriptMessage(WebKitUserContentManager*, JSCValue* value, gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    if (app->webView_ == nullptr ||
        g_strcmp0(webkit_web_view_get_uri(app->webView_), kReaderUrl) != 0) {
        return;
    }
    // The reader posts JSON text. An object is accepted too.
    JSCValue* message = nullptr;
    if (jsc_value_is_string(value)) {
        char* text = jsc_value_to_string(value);
        if (text != nullptr && std::strlen(text) <= kMaximumMessageBytes) {
            message = jsc_value_new_from_json(jsc_value_get_context(value), text);
        }
        g_free(text);
    } else if (jsc_value_is_object(value)) {
        message = JSC_VALUE(g_object_ref(value));
    }
    if (message != nullptr && jsc_value_is_object(message)) {
        app->HandleMessage(message);
    }
    g_clear_object(&message);
}

gboolean LinuxApp::OnDecidePolicy(
    WebKitWebView*,
    WebKitPolicyDecision* decision,
    WebKitPolicyDecisionType type,
    gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
        webkit_policy_decision_ignore(decision);
        return TRUE;
    }
    if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
        auto* navigation = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
        WebKitNavigationAction* action =
            webkit_navigation_policy_decision_get_navigation_action(navigation);
        const char* uri = webkit_uri_request_get_uri(webkit_navigation_action_get_request(action));
        if (uri != nullptr &&
            (g_strcmp0(uri, kReaderUrl) == 0 || g_strcmp0(uri, "about:blank") == 0)) {
            webkit_policy_decision_use(decision);
            return TRUE;
        }
        webkit_policy_decision_ignore(decision);
        // A file dropped on the page arrives as a navigation to its file URI.
        // It is opened as a tab instead; the page itself never navigates.
        if (uri != nullptr && g_ascii_strncasecmp(uri, "file:", 5) == 0) {
            char* path = g_filename_from_uri(uri, nullptr, nullptr);
            if (path != nullptr) {
                if (core::IsSupportedDocumentPath(path)) {
                    app->OpenPaths({std::filesystem::path(path)});
                } else {
                    app->SendStatus(
                        "LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.",
                        "warning");
                }
                g_free(path);
            }
        }
        return TRUE;
    }
    if (type == WEBKIT_POLICY_DECISION_TYPE_RESPONSE) {
        auto* response = WEBKIT_RESPONSE_POLICY_DECISION(decision);
        if (webkit_response_policy_decision_is_main_frame_main_resource(response) &&
            !webkit_response_policy_decision_is_mime_type_supported(response)) {
            webkit_policy_decision_ignore(decision);
        } else {
            webkit_policy_decision_use(decision);
        }
        return TRUE;
    }
    return FALSE;
}

// The page's context menu keeps only copy and text-editing actions. WebKit's
// own items such as "Download Linked File", "Open Link", and "Open Image in
// New Window" would fetch what the document points to.
static bool IsAllowedContextMenuAction(WebKitContextMenuAction action) {
    switch (action) {
        case WEBKIT_CONTEXT_MENU_ACTION_NO_ACTION:  // separators
        case WEBKIT_CONTEXT_MENU_ACTION_COPY:
        case WEBKIT_CONTEXT_MENU_ACTION_COPY_LINK_TO_CLIPBOARD:
        case WEBKIT_CONTEXT_MENU_ACTION_CUT:
        case WEBKIT_CONTEXT_MENU_ACTION_PASTE:
        case WEBKIT_CONTEXT_MENU_ACTION_PASTE_AS_PLAIN_TEXT:
        case WEBKIT_CONTEXT_MENU_ACTION_DELETE:
        case WEBKIT_CONTEXT_MENU_ACTION_SELECT_ALL:
            return true;
        default:
            return false;
    }
}

gboolean LinuxApp::OnContextMenu(
    WebKitWebView*, WebKitContextMenu* menu, WebKitHitTestResult*, gpointer data) {
    std::vector<WebKitContextMenuItem*> removed;
    for (GList* item = webkit_context_menu_get_items(menu); item != nullptr; item = item->next) {
        auto* entry = WEBKIT_CONTEXT_MENU_ITEM(item->data);
        if (!IsAllowedContextMenuAction(webkit_context_menu_item_get_stock_action(entry)) ||
            webkit_context_menu_item_get_submenu(entry) != nullptr) {
            removed.push_back(entry);
        }
    }
    for (WebKitContextMenuItem* entry : removed) {
        webkit_context_menu_remove(menu, entry);
    }
    // Drop separators left at either end or doubled up.
    removed.clear();
    WebKitContextMenuItem* lastKept = nullptr;
    for (GList* item = webkit_context_menu_get_items(menu); item != nullptr; item = item->next) {
        auto* entry = WEBKIT_CONTEXT_MENU_ITEM(item->data);
        const bool separator = webkit_context_menu_item_is_separator(entry);
        if (separator && (lastKept == nullptr || webkit_context_menu_item_is_separator(lastKept))) {
            removed.push_back(entry);
        } else {
            lastKept = entry;
        }
    }
    if (lastKept != nullptr && webkit_context_menu_item_is_separator(lastKept)) {
        removed.push_back(lastKept);
    }
    for (WebKitContextMenuItem* entry : removed) {
        webkit_context_menu_remove(menu, entry);
    }
    const guint remaining = webkit_context_menu_get_n_items(menu);
    auto* app = static_cast<LinuxApp*>(data);
    if (app->testScript_) {
        std::string actions;
        for (GList* item = webkit_context_menu_get_items(menu); item != nullptr; item = item->next) {
            actions += actions.empty() ? "" : ",";
            actions += std::to_string(static_cast<int>(webkit_context_menu_item_get_stock_action(
                WEBKIT_CONTEXT_MENU_ITEM(item->data))));
        }
        std::printf("LEANDOC_EVENT context-menu actions=%s\n", actions.c_str());
        std::fflush(stdout);
    }
    // TRUE suppresses the menu when nothing is left.
    return remaining == 0 ? TRUE : FALSE;
}

GtkWidget* LinuxApp::OnCreateWebView(WebKitWebView*, WebKitNavigationAction*, gpointer) {
    return nullptr;
}

gboolean LinuxApp::OnPermissionRequest(
    WebKitWebView*, WebKitPermissionRequest* request, gpointer) {
    webkit_permission_request_deny(request);
    return TRUE;
}

gboolean LinuxApp::OnQueryPermissionState(
    WebKitWebView*, WebKitPermissionStateQuery* query, gpointer) {
    webkit_permission_state_query_finish(query, WEBKIT_PERMISSION_STATE_DENIED);
    return TRUE;
}

void LinuxApp::OnDownloadStarted(WebKitNetworkSession*, WebKitDownload* download, gpointer) {
    webkit_download_cancel(download);
}

gboolean LinuxApp::OnScriptDialog(WebKitWebView*, WebKitScriptDialog* dialog, gpointer) {
    webkit_script_dialog_close(dialog);
    return TRUE;
}

gboolean LinuxApp::OnRunFileChooser(
    WebKitWebView*, WebKitFileChooserRequest* request, gpointer) {
    webkit_file_chooser_request_cancel(request);
    return TRUE;
}

gboolean LinuxApp::OnEnterFullscreen(WebKitWebView*, gpointer) {
    return TRUE;
}

gboolean LinuxApp::OnPrint(WebKitWebView*, WebKitPrintOperation*, gpointer) {
    return TRUE;
}

void LinuxApp::OnWebProcessTerminated(
    WebKitWebView*, WebKitWebProcessTerminationReason, gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    if (app->smokeTest_) {
        app->CompleteSmoke(false, "The WebKit web process exited.");
        return;
    }
    // One window holds every tab, so the reader is reloaded, but only a few
    // times a minute: a document that keeps crashing the renderer must not
    // trap the window in a reload loop. After three recoveries the active
    // tab shows an error page instead of the document; after one more the
    // window stays as it is.
    const auto now = std::chrono::steady_clock::now();
    if (app->recoveriesInWindow_ == 0 || now - app->recoveryWindowStart_ > std::chrono::minutes(1)) {
        app->recoveryWindowStart_ = now;
        app->recoveriesInWindow_ = 0;
    }
    ++app->recoveriesInWindow_;
    if (app->recoveriesInWindow_ > 4) {
        return;
    }
    if (app->recoveriesInWindow_ == 4) {
        if (Tab* tab = app->ActiveTab()) {
            tab->rendererStopped = true;
        }
    }
    if (app->testScript_) {
        std::printf("LEANDOC_EVENT web-process-terminated recoveries=%u\n",
                    app->recoveriesInWindow_);
        std::fflush(stdout);
    }
    app->NavigateToReader();
}

gboolean LinuxApp::OnDrop(GtkDropTarget*, const GValue* value, double, double, gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    if (!G_VALUE_HOLDS(value, GDK_TYPE_FILE_LIST)) {
        return FALSE;
    }
    auto* list = static_cast<GdkFileList*>(g_value_get_boxed(value));
    GSList* files = gdk_file_list_get_files(list);
    std::vector<std::filesystem::path> paths;
    for (GSList* item = files; item != nullptr; item = item->next) {
        char* path = g_file_get_path(G_FILE(item->data));
        if (path != nullptr) {
            if (core::IsSupportedDocumentPath(path)) {
                paths.emplace_back(path);
            }
            g_free(path);
        }
    }
    g_slist_free(files);
    if (paths.empty()) {
        app->SendStatus(
            "LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.", "warning");
        return FALSE;
    }
    app->OpenPaths(paths);
    return TRUE;
}

void LinuxApp::OnOpenDialogFinished(GObject* source, GAsyncResult* result, gpointer data) {
    auto* window = GTK_WIDGET(data);
    auto* app = static_cast<LinuxApp*>(g_object_get_data(G_OBJECT(window), "leandoc-app"));
    GError* error = nullptr;
    GListModel* files =
        gtk_file_dialog_open_multiple_finish(GTK_FILE_DIALOG(source), result, &error);
    if (files != nullptr && app != nullptr) {
        std::vector<std::filesystem::path> paths;
        const guint count = g_list_model_get_n_items(files);
        for (guint index = 0; index < count; ++index) {
            auto* file = G_FILE(g_list_model_get_item(files, index));
            char* path = g_file_get_path(file);
            if (path != nullptr) {
                paths.emplace_back(path);
                g_free(path);
            }
            g_object_unref(file);
        }
        if (paths.empty()) {
            app->SendStatus("LeanDoc can open local files only.", "warning");
        } else {
            app->OpenPaths(paths);
        }
    }
    g_clear_object(&files);
    g_clear_error(&error);
    g_object_unref(source);
    g_object_unref(window);
}

void LinuxApp::OnDirectoryChanged(
    GFileMonitor*, GFile* file, GFile* otherFile, GFileMonitorEvent, gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    const Tab* tab = app->ActiveTab();
    if (tab == nullptr) {
        return;
    }
    const std::string expected = tab->path.filename().string();
    bool matches = false;
    for (GFile* candidate : {file, otherFile}) {
        if (candidate == nullptr) {
            continue;
        }
        char* basename = g_file_get_basename(candidate);
        if (basename != nullptr && expected == basename) {
            matches = true;
        }
        g_free(basename);
    }
    if (matches) {
        app->ScheduleReload();
    }
}

void LinuxApp::OnSmokeProbeFinished(GObject* source, GAsyncResult* result, gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    GError* error = nullptr;
    JSCValue* value =
        webkit_web_view_evaluate_javascript_finish(WEBKIT_WEB_VIEW(source), result, &error);
    if (value == nullptr || !jsc_value_is_string(value)) {
        const std::string reason =
            error != nullptr ? error->message : "The DOM probe returned no result.";
        g_clear_error(&error);
        g_clear_object(&value);
        app->CompleteSmoke(false, reason);
        return;
    }
    char* text = jsc_value_to_string(value);
    JSCValue* parsed = jsc_value_new_from_json(jsc_value_get_context(value), text);
    const std::string summary = text == nullptr ? "" : text;
    g_free(text);
    g_object_unref(value);

    const auto pages = parsed == nullptr ? std::nullopt : UnsignedProperty(parsed, "pages");
    const auto offOrigin =
        parsed == nullptr ? std::nullopt : UnsignedProperty(parsed, "offOrigin");
    const auto csp = parsed == nullptr ? std::nullopt : UnsignedProperty(parsed, "csp");
    const auto textLength = parsed == nullptr ? std::nullopt : UnsignedProperty(parsed, "text");
    const auto state = parsed == nullptr ? std::nullopt : StringProperty(parsed, "state");
    g_clear_object(&parsed);
    const bool success = state.value_or("") == "ready" && pages.value_or(0) >= 1 &&
                         textLength.value_or(0) > 0 &&
                         offOrigin.value_or(1) == 0 && csp.value_or(1) == 0;
    app->CompleteSmoke(
        success, summary + " renderMs=" + std::to_string(app->smokeRenderMs_));
}

gboolean LinuxApp::OnReloadTimer(gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    app->reloadTimer_ = 0;
    if (app->ActiveTab() != nullptr && app->readerReady_) {
        app->ShowActiveTab(true);
    }
    return G_SOURCE_REMOVE;
}

gboolean LinuxApp::OnExitAfterRender(gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    app->exitTimer_ = 0;
    g_application_quit(G_APPLICATION(app->application_));
    return G_SOURCE_REMOVE;
}

void LinuxApp::OnWindowMapped(GtkWidget* widget, gpointer) {
    // Only the first map counts; later maps follow a minimize.
    g_signal_handlers_disconnect_by_func(
        widget, reinterpret_cast<gpointer>(OnWindowMapped), nullptr);
    TraceTiming("window-visible");
}

gboolean LinuxApp::OnSmokeTimeout(gpointer data) {
    auto* app = static_cast<LinuxApp*>(data);
    app->smokeTimeout_ = 0;
    app->CompleteSmoke(false, "Timed out before the reader reported a rendered document.");
    return G_SOURCE_REMOVE;
}

}  // namespace leandoc::linux_host
