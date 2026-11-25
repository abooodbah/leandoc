// The interface language on macOS: the reader's choice, saved as
// LeanDocLanguage beside the theme, or the system's first preferred language.
// The rules are the shared ones in core/ReaderSettings.h, and the host's own
// strings (menus, the open panel, error alerts) come from core/InterfaceText.h.
#pragma once

#import <Foundation/Foundation.h>

#include "core/InterfaceText.h"
#include "core/ReaderSettings.h"

NS_ASSUME_NONNULL_BEGIN

static NSString *const LDLanguageKey = @"LeanDocLanguage";

// The saved setting. The smoke tests stand a choice in with
// LEANDOC_SMOKE_LANGUAGE, which is never saved.
static inline leandoc::settings::Language LDLanguageSetting(void) {
    NSProcessInfo *process = NSProcessInfo.processInfo;
    NSString *smoke = process.environment[@"LEANDOC_SMOKE_LANGUAGE"];
    if (smoke.length > 0 && [process.arguments containsObject:@"--smoke-test"]) {
        return leandoc::settings::ParseLanguage(smoke.UTF8String != nullptr ? smoke.UTF8String : "");
    }
    NSString *saved = [NSUserDefaults.standardUserDefaults stringForKey:LDLanguageKey];
    return leandoc::settings::ParseLanguage(saved.UTF8String != nullptr ? saved.UTF8String : "");
}

static inline NSString *LDSystemLanguage(void) {
    NSString *first = NSLocale.preferredLanguages.firstObject;
    return first != nil ? first : @"";
}

// "en", "zh-CN", or "ja".
static inline const char *LDInterfaceLanguage(void) {
    NSString *system = LDSystemLanguage();
    return leandoc::settings::ResolveInterfaceLanguage(
        LDLanguageSetting(), system.UTF8String != nullptr ? system.UTF8String : "");
}

static inline NSString *LDText(const leandoc::interface_text::NativeText &text) {
    return @(leandoc::interface_text::Localized(text, LDInterfaceLanguage()));
}

NS_ASSUME_NONNULL_END
