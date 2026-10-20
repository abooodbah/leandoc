// libFuzzer harness: any bytes go through OpenDocumentBytes and, when a
// sanitized package comes out, that package is opened again. Build with
// -DLEANDOC_ENABLE_FUZZ=ON using Clang; see tests/core/README.md.

#include <cstddef>
#include <cstdint>
#include <string_view>

#include "core/DocCore.h"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    namespace core = leandoc::core;
    // Smaller limits keep each run fast without skipping any code path.
    core::Limits limits;
    limits.maximumPartBytes = 8ull * 1024ull * 1024ull;
    limits.maximumTotalUncompressedBytes = 32ull * 1024ull * 1024ull;
    const std::string_view bytes(reinterpret_cast<const char*>(data), size);

    const core::OpenResult result = core::OpenDocumentBytes(bytes, limits);
    (void)core::ReportToJson(result);
    (void)core::DetectKind(bytes);
    if (!result.sanitizedPackage.empty()) {
        const core::OpenResult again = core::OpenDocumentBytes(result.sanitizedPackage, limits);
        if (!again.ok) {
            // A sanitized package must always reopen.
            __builtin_trap();
        }
    }
    return 0;
}
