#import "LDTiming.h"

#include <sys/sysctl.h>
#include <sys/time.h>
#include <unistd.h>

#include <cstdio>

namespace {

BOOL timingEnabled = NO;

// The kernel's wall-clock start time of this process, in milliseconds.
double ProcessStartMilliseconds(void) {
    static double start = -1;
    if (start < 0) {
        int name[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
        struct kinfo_proc info = {};
        size_t size = sizeof(info);
        if (sysctl(name, 4, &info, &size, nullptr, 0) == 0 && size > 0) {
            const struct timeval begun = info.kp_proc.p_starttime;
            start = begun.tv_sec * 1000.0 + begun.tv_usec / 1000.0;
        } else {
            start = 0;
        }
    }
    return start;
}

}  // namespace

void LDEnableTiming(void) {
    timingEnabled = YES;
    ProcessStartMilliseconds();
}

BOOL LDTimingEnabled(void) {
    return timingEnabled;
}

void LDTraceTiming(NSString *event, NSString *details) {
    if (!timingEnabled) {
        return;
    }
    struct timeval now = {};
    gettimeofday(&now, nullptr);
    const double current = now.tv_sec * 1000.0 + now.tv_usec / 1000.0;
    const double start = ProcessStartMilliseconds();
    const unsigned long long elapsed =
        start > 0 && current > start ? static_cast<unsigned long long>(current - start) : 0;
    NSString *line = details.length > 0
                         ? [NSString stringWithFormat:@"LEANDOC_TIMING %@ %llu %@\n", event,
                                                      elapsed, details]
                         : [NSString stringWithFormat:@"LEANDOC_TIMING %@ %llu\n", event, elapsed];
    std::fputs(line.UTF8String, stdout);
    std::fflush(stdout);
}

long LDParseExitAfterRender(NSString *argument) {
    NSString *const prefix = @"--exit-after-render=";
    if (![argument hasPrefix:prefix]) {
        return -1;
    }
    NSString *digits = [argument substringFromIndex:prefix.length];
    if (digits.length == 0 || digits.length > 6) {
        return -1;
    }
    long value = 0;
    for (NSUInteger index = 0; index < digits.length; ++index) {
        const unichar digit = [digits characterAtIndex:index];
        if (digit < '0' || digit > '9') {
            return -1;
        }
        value = value * 10 + (digit - '0');
    }
    return value <= 600000 ? value : -1;
}
