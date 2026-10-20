#pragma once

#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

// Maps every supported extension to LDDocument by extension, so a file opens
// even when macOS gives it a type identifier the Info.plist does not list,
// and shows an open panel limited to the seven extensions.
@interface LDDocumentController : NSDocumentController

+ (BOOL)isSupportedURL:(NSURL *)URL;

@end

NS_ASSUME_NONNULL_END
