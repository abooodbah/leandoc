// libFuzzer harness for OpenDocumentBytes. Each input is used twice:
//
// 1. as a whole file, which exercises classification and the ZIP reader;
// 2. as the body of word/document.xml inside a valid stored package, which
//    reaches the XML parser, the analysis, the sanitizer, and the outline
//    directly (mutated ZIP bytes rarely get past the CRC check).
//
// Whenever a sanitized package comes out, it is opened again and must be ok.
// Build with -DLEANDOC_ENABLE_FUZZ=ON using Clang; see tests/core/README.md.

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

#include "TestZip.h"
#include "core/DocCore.h"

namespace {

namespace core = leandoc::core;

void OpenAndReopen(std::string_view bytes, const core::Limits& limits) {
    const core::OpenResult result = core::OpenDocumentBytes(bytes, limits);
    (void)core::ReportToJson(result);
    if (!result.sanitizedPackage.empty()) {
        const core::OpenResult again = core::OpenDocumentBytes(result.sanitizedPackage, limits);
        if (!again.ok) {
            // A sanitized package must always reopen.
            __builtin_trap();
        }
        (void)core::ReportToJson(again);
    }
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    // Smaller limits keep each run fast without skipping any code path.
    core::Limits limits;
    limits.maximumPartBytes = 8ull * 1024ull * 1024ull;
    limits.maximumTotalUncompressedBytes = 32ull * 1024ull * 1024ull;
    const std::string_view bytes(reinterpret_cast<const char*>(data), size);

    (void)core::DetectKind(bytes);
    OpenAndReopen(bytes, limits);

    if (size <= 256 * 1024) {
        const std::string package =
            leandoc::tests::BuildZip(leandoc::tests::MinimalDocx(std::string(bytes)));
        OpenAndReopen(package, limits);
    }
    return 0;
}
