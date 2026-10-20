#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// SPEC section 5 test hooks. --trace-timing prints
// "LEANDOC_TIMING <event> <ms since process start> [key=value ...]" to stdout,
// flushed per line. Until LDEnableTiming() is called nothing is printed.
void LDEnableTiming(void);
BOOL LDTimingEnabled(void);
void LDTraceTiming(NSString *event, NSString *_Nullable details);

// --exit-after-render=MS: 0 to 600000 plain decimal digits, or -1 when the
// argument is not that flag or its value is not valid.
long LDParseExitAfterRender(NSString *argument);

NS_ASSUME_NONNULL_END
