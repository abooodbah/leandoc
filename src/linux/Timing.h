#pragma once

#include <cstdint>
#include <string_view>

namespace leandoc::linux_host {

// --trace-timing. Until EnableTiming() is called, TraceTiming() does nothing.
void EnableTiming();
bool TimingEnabled();
// Milliseconds since the kernel started this process.
std::uint64_t MillisecondsSinceProcessStart();
// Prints "LEANDOC_TIMING <event> <ms> [details]" and flushes stdout.
void TraceTiming(std::string_view event, std::string_view details = {});

}  // namespace leandoc::linux_host
