// Portable checks of the host logic that does not need a window: the
// open-in-editor order on Windows and Linux, Windows command-line quoting, and
// the reader message parser. CTest runs this on every operating system.

#include "linux/EditorChoice.h"
#include "linux/TestHooks.h"
#include "windows/EditorChoice.h"
#include "windows/HostJson.h"
#include "windows/TestHooks.h"

#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

namespace {

int failures = 0;

void Check(bool condition, const char* description) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL  " << description << '\n';
    }
}

std::string Narrow(const std::wstring& value) {
    std::string output;
    for (const wchar_t character : value) {
        output.push_back(character < 0x80 ? static_cast<char>(character) : '?');
    }
    return output;
}

// The reverse of QuoteArgument, following CommandLineToArgvW for arguments
// after the first: 2n backslashes and a quote give n backslashes and toggle
// quoting; 2n+1 give n backslashes and a literal quote.
std::vector<std::wstring> SplitCommandLine(const std::wstring& line) {
    std::vector<std::wstring> arguments;
    std::wstring current;
    bool quoted = false;
    bool any = false;
    for (std::size_t index = 0; index < line.size();) {
        const wchar_t character = line[index];
        if (character == L'\\') {
            std::size_t count = 0;
            while (index < line.size() && line[index] == L'\\') {
                ++count;
                ++index;
            }
            if (index < line.size() && line[index] == L'"') {
                current.append(count / 2, L'\\');
                if (count % 2 == 1) {
                    current.push_back(L'"');
                    ++index;
                }
            } else {
                current.append(count, L'\\');
            }
            any = true;
            continue;
        }
        if (character == L'"') {
            quoted = !quoted;
            any = true;
            ++index;
            continue;
        }
        if ((character == L' ' || character == L'\t') && !quoted) {
            if (any) {
                arguments.push_back(current);
                current.clear();
                any = false;
            }
            ++index;
            continue;
        }
        current.push_back(character);
        any = true;
        ++index;
    }
    if (any) {
        arguments.push_back(current);
    }
    return arguments;
}

void TestWindowsEditorOrder() {
    using namespace leandoc::windows_host;
    const auto toUtf8 = [](const std::wstring& value) { return Narrow(value); };

    EditorCandidates all;
    all.word = L"C:\\Office\\WINWORD.EXE";
    all.libreOffice = L"C:\\LibreOffice\\program\\soffice.exe";
    all.defaultApp = L"C:\\Apps\\Writer.exe";
    all.defaultAppName = L"Writer";
    auto choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::Word && choice.label == "Open in Word",
          "Windows prefers Word when it is installed");

    all.word.clear();
    choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::LibreOffice && choice.label == "Open in LibreOffice",
          "Windows falls back to LibreOffice");

    all.libreOffice.clear();
    choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::Default && choice.label == "Open in Writer",
          "Windows falls back to the named default app");

    all.defaultAppName.clear();
    choice = ChooseEditor(all, toUtf8);
    Check(choice.label == "Open with default app", "an unnamed default app has a generic label");

    all.defaultIsSelf = true;
    choice = ChooseEditor(all, toUtf8);
    Check(choice.kind == EditorKind::Web && choice.label == "Open Word for the web" &&
              choice.target == kWordForTheWebUrl,
          "LeanDoc never offers itself; the last resort is Word for the web");
    Check(std::string(EditorKindName(EditorKind::Web)) == "web" &&
              std::string(EditorKindName(EditorKind::Default)) == "default" &&
              std::string(EditorKindName(EditorKind::LibreOffice)) == "libreoffice" &&
              std::string(EditorKindName(EditorKind::Word)) == "word",
          "Windows editor kinds use the protocol names");
}

void TestLinuxEditorOrder() {
    using namespace leandoc::linux_host;
    EditorCandidates candidates;
    candidates.libreOffice = "/usr/bin/libreoffice";
    candidates.defaultApp = "org.example.Writer.desktop";
    candidates.defaultAppName = "Writer";
    auto choice = ChooseEditor(candidates);
    Check(choice.kind == EditorKind::LibreOffice && !choice.targetIsDesktopId,
          "Linux prefers LibreOffice on PATH");

    candidates.libreOffice = "libreoffice-writer.desktop";
    candidates.libreOfficeIsDesktopId = true;
    choice = ChooseEditor(candidates);
    Check(choice.kind == EditorKind::LibreOffice && choice.targetIsDesktopId,
          "Linux accepts LibreOffice Writer's desktop entry");

    candidates.libreOffice.clear();
    choice = ChooseEditor(candidates);
    Check(choice.kind == EditorKind::Default && choice.label == "Open in Writer" &&
              choice.targetIsDesktopId,
          "Linux falls back to the default application for Word documents");

    candidates.defaultIsSelf = true;
    choice = ChooseEditor(candidates);
    Check(choice.kind == EditorKind::Web && choice.target == kWordForTheWebUrl,
          "Linux never offers LeanDoc itself and ends with Word for the web");
}

void TestQuoting() {
    using leandoc::windows_host::BuildCommandLine;
    const std::vector<std::wstring> cases[] = {
        {L"C:\\Program Files\\LibreOffice\\program\\soffice.exe", L"C:\\Docs\\Plan.docx"},
        {L"C:\\Office\\WINWORD.EXE", L"C:\\My Docs\\Trailing\\"},
        {L"C:\\a.exe", L"C:\\x\\\"quoted\" name.docx"},
        {L"C:\\a.exe", L""},
        {L"C:\\a.exe", L"tab\there"},
        {L"C:\\a.exe", L"back\\\\slashes\\\\"},
    };
    for (const auto& arguments : cases) {
        const std::wstring line = BuildCommandLine(arguments);
        const auto parsed = SplitCommandLine(line);
        Check(parsed == arguments, ("command line round trip: " + Narrow(line)).c_str());
    }
    Check(BuildCommandLine({L"C:\\a.exe", L"plain"}) == L"C:\\a.exe plain",
          "plain arguments are not quoted");
}

void TestJson() {
    using namespace leandoc::host_json;
    auto message = ParseMessage(
        R"("{\"type\":\"rendered\",\"tab\":3,\"generation\":2,\"pages\":12,\"ms\":40.5}")");
    Check(message.has_value(), "a JSON string holding an object parses");
    if (message) {
        Check(GetString(*message, "type") == std::optional<std::string>("rendered"),
              "type is read");
        Check(GetUnsigned(*message, "tab") == std::optional<unsigned>(3u), "tab is read");
        Check(!GetUnsigned(*message, "ms").has_value(), "a fraction is not an unsigned value");
    }
    message = ParseMessage(R"({"type":"link","href":"https://example.com/a?b=\u00e9&c=\ud83d\ude00"})");
    Check(message && GetString(*message, "href") ==
                         std::optional<std::string>("https://example.com/a?b=\xC3\xA9&c=\xF0\x9F\x98\x80"),
          "escapes and surrogate pairs decode to UTF-8");
    message = ParseMessage(R"({"type":"x","nested":{"a":[1,2,{"b":null}]},"flag":true})");
    Check(message && GetString(*message, "type").has_value(), "nested values are skipped");
    Check(!ParseMessage(R"({"type":"x",})").has_value(), "a trailing comma is refused");
    Check(!ParseMessage(R"({"type":"x"} extra)").has_value(), "trailing text is refused");
    Check(!ParseMessage(R"({"type":"\ud800"})").has_value(), "a lone surrogate is refused");
    Check(!ParseMessage("[1,2]").has_value(), "an array is not a message");
    Check(!ParseMessage(R"("not an object")").has_value(), "a plain string is not a message");
    std::string deep;
    for (int index = 0; index < 40; ++index) {
        deep += "{\"a\":";
    }
    deep += "1";
    for (int index = 0; index < 40; ++index) {
        deep += "}";
    }
    Check(!ParseMessage(deep).has_value(), "nesting is bounded");
    Check(!ParseMessage(std::string(70000, ' ')).has_value(), "size is bounded");
    message = ParseMessage(R"({"type":"selectTab","id":-1})");
    Check(message && !GetUnsigned(*message, "id").has_value(), "negative ids are refused");
}

}  // namespace

// SPEC section 5 test hooks: the flag parser rejects anything but plain
// milliseconds, and trace lines have one fixed shape on every host.
void TestHooks() {
    namespace lh = leandoc::linux_host;
    namespace wh = leandoc::windows_host;
    Check(lh::ParseExitAfterRender("--exit-after-render=0") == 0u, "Linux accepts 0 ms");
    Check(lh::ParseExitAfterRender("--exit-after-render=1500") == 1500u,
          "Linux accepts 1500 ms");
    Check(lh::ParseExitAfterRender("--exit-after-render=600000") == 600000u,
          "Linux accepts the 600000 ms ceiling");
    Check(!lh::ParseExitAfterRender("--exit-after-render=600001"),
          "Linux rejects more than 600000 ms");
    Check(!lh::ParseExitAfterRender("--exit-after-render="), "Linux rejects an empty value");
    Check(!lh::ParseExitAfterRender("--exit-after-render=-5"), "Linux rejects a sign");
    Check(!lh::ParseExitAfterRender("--exit-after-render=1e3"), "Linux rejects exponents");
    Check(!lh::ParseExitAfterRender("--exit-after-renders=5"), "Linux rejects other flags");
    Check(lh::FormatTimingLine("rendered", 812, "pages=3 readerMs=140") ==
              "LEANDOC_TIMING rendered 812 pages=3 readerMs=140",
          "Linux trace line shape");
    Check(lh::FormatTimingLine("process-start", 4) == "LEANDOC_TIMING process-start 4",
          "Linux trace line without details");

    Check(wh::ParseExitAfterRender(L"--exit-after-render=250") == 250u,
          "Windows accepts 250 ms");
    Check(!wh::ParseExitAfterRender(L"--exit-after-render=abc"),
          "Windows rejects letters");
    Check(!wh::ParseExitAfterRender(L"--exit-after-render=1234567"),
          "Windows rejects seven digits");
    Check(wh::FormatTimingLine("package-served", 90, "coreMs=3 bytes=10") ==
              "LEANDOC_TIMING package-served 90 coreMs=3 bytes=10\n",
          "Windows trace line shape");
}

// --test-script lines: one command per line, the argument kept as written.
void TestScriptCommands() {
    namespace lh = leandoc::linux_host;
    using Kind = lh::ScriptCommandKind;
    Check(lh::ParseScriptCommand("").kind == Kind::Empty, "a blank script line is empty");
    Check(lh::ParseScriptCommand("  # note").kind == Kind::Empty, "a comment is empty");
    const auto js = lh::ParseScriptCommand("js return {a: 1}\r\n");
    Check(js.kind == Kind::Js && js.argument == "return {a: 1}",
          "js keeps its body and drops the line ending");
    Check(lh::ParseScriptCommand("js").kind == Kind::Invalid, "js needs a body");
    Check(lh::ParseScriptCommand("wait document.body").kind == Kind::Wait, "wait parses");
    Check(lh::ParseScriptCommand("wait-render").kind == Kind::WaitRender, "wait-render parses");
    Check(lh::ParseScriptCommand("wait-render 5").kind == Kind::Invalid,
          "wait-render takes no argument");
    const auto open = lh::ParseScriptCommand("open /tmp/a b.docx");
    Check(open.kind == Kind::Open && open.argument == "/tmp/a b.docx",
          "open keeps spaces in the path");
    const auto sleep = lh::ParseScriptCommand("sleep 250");
    Check(sleep.kind == Kind::Sleep && sleep.number == 250u, "sleep takes milliseconds");
    Check(lh::ParseScriptCommand("sleep -1").kind == Kind::Invalid, "sleep rejects a sign");
    Check(lh::ParseScriptCommand("sleep 99999999").kind == Kind::Invalid,
          "sleep rejects eight digits");
    const auto resize = lh::ParseScriptCommand("resize 800 600");
    Check(resize.kind == Kind::Resize && resize.number == 800u && resize.secondNumber == 600u,
          "resize takes a width and a height");
    Check(lh::ParseScriptCommand("resize 100 100").kind == Kind::Invalid,
          "resize refuses tiny windows");
    Check(lh::ParseScriptCommand("system-theme dark").kind == Kind::SystemTheme,
          "system-theme dark parses");
    Check(lh::ParseScriptCommand("system-theme blue").kind == Kind::Invalid,
          "system-theme accepts light and dark only");
    Check(lh::ParseScriptCommand("quit").kind == Kind::Quit, "quit parses");
    Check(lh::ParseScriptCommand("rm -rf /").kind == Kind::Invalid,
          "unknown commands are invalid");
}

int main() {
    TestHooks();
    TestScriptCommands();
    TestWindowsEditorOrder();
    TestLinuxEditorOrder();
    TestQuoting();
    TestJson();
    if (failures != 0) {
        std::cerr << failures << " host logic check(s) failed.\n";
        return EXIT_FAILURE;
    }
    std::cout << "LeanDoc host logic checks passed.\n";
    return EXIT_SUCCESS;
}
