#include "Timing.h"

#include <time.h>
#include <unistd.h>

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "TestHooks.h"

namespace leandoc::linux_host {
namespace {

bool timingEnabled = false;

// The kernel's start time of this process on the boot-time clock, in
// milliseconds. Field 22 of /proc/self/stat counts clock ticks since boot.
std::uint64_t ProcessStartMilliseconds() {
    static const std::uint64_t start = [] {
        std::ifstream stat("/proc/self/stat");
        std::string text;
        std::getline(stat, text);
        // The command name in field 2 may contain spaces, so count fields
        // after its closing parenthesis.
        const std::size_t close = text.rfind(')');
        if (close == std::string::npos) {
            return std::uint64_t{0};
        }
        std::istringstream fields(text.substr(close + 2));
        std::string field;
        unsigned long long ticks = 0;
        for (int index = 3; index <= 22 && fields >> field; ++index) {
            if (index == 22) {
                ticks = std::stoull(field);
            }
        }
        const long perSecond = sysconf(_SC_CLK_TCK);
        return perSecond > 0 ? static_cast<std::uint64_t>(ticks * 1000ull / perSecond)
                             : std::uint64_t{0};
    }();
    return start;
}

std::uint64_t BootClockMilliseconds() {
    timespec now = {};
    clock_gettime(CLOCK_BOOTTIME, &now);
    return static_cast<std::uint64_t>(now.tv_sec) * 1000ull +
           static_cast<std::uint64_t>(now.tv_nsec) / 1000000ull;
}

}  // namespace

void EnableTiming() {
    timingEnabled = true;
    ProcessStartMilliseconds();
}

bool TimingEnabled() {
    return timingEnabled;
}

std::uint64_t MillisecondsSinceProcessStart() {
    const std::uint64_t start = ProcessStartMilliseconds();
    const std::uint64_t now = BootClockMilliseconds();
    return start != 0 && now > start ? now - start : 0;
}

void TraceTiming(std::string_view event, std::string_view details) {
    if (!timingEnabled) {
        return;
    }
    const std::string line =
        FormatTimingLine(event, MillisecondsSinceProcessStart(), details) + "\n";
    std::fwrite(line.data(), 1, line.size(), stdout);
    std::fflush(stdout);
}

}  // namespace leandoc::linux_host
