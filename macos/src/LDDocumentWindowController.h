#pragma once

#import <AppKit/AppKit.h>

@class LDDocument;

NS_ASSUME_NONNULL_BEGIN

@interface LDDocumentWindowController : NSWindowController

- (instancetype)initWithDocument:(LDDocument *)document NS_DESIGNATED_INITIALIZER;
- (instancetype)initWithWindow:(nullable NSWindow *)window NS_UNAVAILABLE;
- (instancetype)initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

- (void)documentContentDidChange;
- (void)showStatus:(NSString *)message tone:(NSString *)tone;
- (void)cycleTheme;

// Waits for the reader's "rendered" message for this document, then checks
// the DOM. Used by --smoke-test.
- (void)runSmokeCheckWithCompletion:(void (^)(BOOL success, NSString *detail))completion;

@end

NS_ASSUME_NONNULL_END
