#include <gtk/gtk.h>
#include <sys/prctl.h>

#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#include "LinuxApp.h"
#include "TestHooks.h"
#include "Timing.h"

namespace {

constexpr char kApplicationId[] = "io.github.abooodbah.leandoc";

struct ApplicationState {
    std::vector<std::filesystem::path> documents;
    leandoc::linux_host::LinuxApp* window = nullptr;
    leandoc::linux_host::HostOptions options;
    bool traceTiming = false;
    int smokeExitCode = 1;
};

bool ParseArguments(int argc, char** argv, ApplicationState* state, bool* showHelp) {
    bool afterSeparator = false;
    for (int index = 1; index < argc; ++index) {
        const std::string argument(argv[index]);
        if (!afterSeparator && argument == "--") {
            afterSeparator = true;
            continue;
        }
        if (!afterSeparator && argument == "--help") {
            *showHelp = true;
            continue;
        }
        if (!afterSeparator && argument == "--smoke-test") {
            if (state->options.smokeTest || index + 1 >= argc) {
                std::cerr << "--smoke-test requires exactly one document path.\n";
                return false;
            }
            state->options.smokeTest = true;
            state->documents.emplace_back(argv[++index]);
            continue;
        }
        if (!afterSeparator && argument == leandoc::linux_host::kTestScriptFlag) {
            if (state->options.testScript || index + 1 >= argc) {
                std::cerr << "--test-script requires exactly one script path.\n";
                return false;
            }
            state->options.testScript = std::filesystem::path(argv[++index]);
            continue;
        }
        if (!afterSeparator && argument == leandoc::linux_host::kTraceTimingFlag) {
            state->traceTiming = true;
            continue;
        }
        if (!afterSeparator &&
            argument.rfind(leandoc::linux_host::kExitAfterRenderFlag, 0) == 0) {
            const auto milliseconds = leandoc::linux_host::ParseExitAfterRender(argument);
            if (!milliseconds) {
                std::cerr << "--exit-after-render needs a whole number of milliseconds "
                             "from 0 to 600000.\n";
                return false;
            }
            state->options.exitAfterRenderMs = milliseconds;
            continue;
        }
        if (!afterSeparator && !argument.empty() && argument.front() == '-') {
            std::cerr << "Unknown option: " << argument << '\n';
            return false;
        }
        state->documents.emplace_back(argument);
    }
    if (state->options.smokeTest && state->options.testScript) {
        std::cerr << "--smoke-test and --test-script cannot be combined.\n";
        return false;
    }
    if (state->options.smokeTest && state->documents.size() != 1) {
        std::cerr << "--smoke-test accepts exactly one document path.\n";
        return false;
    }
    return true;
}

leandoc::linux_host::LinuxApp* EnsureWindow(
    GtkApplication* application, ApplicationState* state) {
    if (state->window == nullptr) {
        state->window = leandoc::linux_host::LinuxApp::Create(
            application, state->options, &state->smokeExitCode);
    }
    return state->window;
}

void Activate(GtkApplication* application, gpointer data) {
    EnsureWindow(application, static_cast<ApplicationState*>(data))->Present();
}

// A later launch arrives here through D-Bus with its files, so they open as
// tabs of the running window instead of starting another web process.
void Open(GApplication* application, GFile** files, gint count, const gchar*, gpointer data) {
    auto* state = static_cast<ApplicationState*>(data);
    std::vector<std::filesystem::path> paths;
    for (gint index = 0; index < count; ++index) {
        char* path = g_file_get_path(files[index]);
        if (path != nullptr) {
            paths.emplace_back(path);
            g_free(path);
        }
    }
    auto* window = EnsureWindow(GTK_APPLICATION(application), state);
    window->OpenPaths(paths);
    window->Present();
}

void ForgetWindow(GtkApplication*, GtkWindow*, gpointer data) {
    // The window owns its LinuxApp; once it is gone a new one is created on
    // the next activation.
    static_cast<ApplicationState*>(data)->window = nullptr;
}

}  // namespace

int main(int argc, char** argv) {
    // With transparent huge pages set to "always", the idle UI heap grew from
    // about 90 to 183 MiB on CI runners (TEST_REPORT D-26). A document viewer
    // gains nothing from huge pages, so they are turned off for this process
    // and the WebKit processes it starts, which inherit the setting.
    prctl(PR_SET_THP_DISABLE, 1, 0, 0, 0);

    ApplicationState state;
    bool showHelp = false;
    if (!ParseArguments(argc, argv, &state, &showHelp)) {
        return 2;
    }
    if (showHelp) {
        std::cout << "Usage: leandoc [--] [DOCUMENT ...]\n"
                  << "       leandoc --smoke-test DOCUMENT\n"
                  << "Test hooks: --trace-timing, --exit-after-render=MS, --test-script FILE\n";
        return 0;
    }
    if (state.traceTiming) {
        leandoc::linux_host::EnableTiming();
        leandoc::linux_host::TraceTiming("process-start");
    }

    // The smoke test and a timed run each start their own instance, so they
    // never hand their file to a reader the user already has open.
    GApplicationFlags flags = G_APPLICATION_HANDLES_OPEN;
    if (state.options.smokeTest || state.options.exitAfterRenderMs) {
        flags = static_cast<GApplicationFlags>(flags | G_APPLICATION_NON_UNIQUE);
    }
    GtkApplication* application = gtk_application_new(kApplicationId, flags);
    g_signal_connect(application, "activate", G_CALLBACK(Activate), &state);
    g_signal_connect(application, "open", G_CALLBACK(Open), &state);
    g_signal_connect(application, "window-removed", G_CALLBACK(ForgetWindow), &state);

    GError* error = nullptr;
    if (!g_application_register(G_APPLICATION(application), nullptr, &error)) {
        // Without a session bus there is no single instance; run on our own.
        g_message("LeanDoc runs without single-instance support: %s", error->message);
        g_clear_error(&error);
        g_object_unref(application);
        flags = static_cast<GApplicationFlags>(flags | G_APPLICATION_NON_UNIQUE);
        application = gtk_application_new(kApplicationId, flags);
        g_signal_connect(application, "activate", G_CALLBACK(Activate), &state);
        g_signal_connect(application, "open", G_CALLBACK(Open), &state);
        g_signal_connect(application, "window-removed", G_CALLBACK(ForgetWindow), &state);
        if (!g_application_register(G_APPLICATION(application), nullptr, &error)) {
            std::cerr << "LeanDoc could not start: " << error->message << '\n';
            g_clear_error(&error);
            g_object_unref(application);
            return 1;
        }
    }

    // LeanDoc parses its own arguments, so dash-prefixed names after `--` stay
    // file names and GTK never reads a document name as an option.
    std::vector<GFile*> files;
    for (const auto& document : state.documents) {
        files.push_back(g_file_new_for_path(document.c_str()));
    }

    int status = 0;
    if (g_application_get_is_remote(G_APPLICATION(application))) {
        if (files.empty()) {
            g_application_activate(G_APPLICATION(application));
        } else {
            g_application_open(
                G_APPLICATION(application), files.data(), static_cast<gint>(files.size()), "");
        }
        GDBusConnection* connection =
            g_application_get_dbus_connection(G_APPLICATION(application));
        if (connection != nullptr) {
            g_dbus_connection_flush_sync(connection, nullptr, nullptr);
        }
    } else {
        if (!files.empty()) {
            g_application_open(
                G_APPLICATION(application), files.data(), static_cast<gint>(files.size()), "");
        }
        char* applicationArguments[] = {argv[0], nullptr};
        status = g_application_run(G_APPLICATION(application), 1, applicationArguments);
    }
    for (GFile* file : files) {
        g_object_unref(file);
    }
    g_object_unref(application);

    if (state.options.smokeTest || state.options.testScript) {
        return state.smokeExitCode;
    }
    return status;
}
