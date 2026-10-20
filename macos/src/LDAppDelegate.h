#pragma once

#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface LDAppDelegate : NSObject <NSApplicationDelegate>

@property(nonatomic, readonly) BOOL smokeTesting;
// --exit-after-render=MS, or -1 when it was not given.
@property(nonatomic, readonly) long exitAfterRenderMs;

- (void)installMainMenu;
// Opens a file from the reader's recent list or the open panel, replacing an
// empty welcome window.
- (void)openURL:(NSURL *)URL;
// Called by a window when the reader reports its first rendered document.
- (void)documentDidRender;

@end

NS_ASSUME_NONNULL_END
