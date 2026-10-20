#pragma once

#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

extern NSString *const LDDocumentTypeName;

// One read-only document per window. The document keeps the sanitized
// package of its file only until the reader has fetched it.
@interface LDDocument : NSDocument

@property(nonatomic, readonly) BOOL hasSourceFile;
@property(nonatomic, readonly) NSUInteger tabId;
@property(nonatomic, readonly) NSUInteger generation;
// How long the core took for the last read, for --trace-timing.
@property(nonatomic, readonly) NSUInteger lastCoreMilliseconds;

// Up to ten recent paths in NSUserDefaults, newest first.
+ (NSArray<NSString *> *)recentPaths;
+ (void)clearRecent;

// Reads the file again when its package was already handed to the reader,
// so the next "document" message has a package to serve.
- (void)preparePackage;
// The message for the reader: "document", "fallback", or "empty".
- (NSDictionary<NSString *, id> *)readerPayload;
// The package for leandoc://app/pkg/<tab>/<generation>/document.docx, or
// nil. It is handed out once; the document then drops it.
- (nullable NSData *)packageForTab:(NSUInteger)tab generation:(NSUInteger)generation;
- (void)reloadFromDisk;

@end

NS_ASSUME_NONNULL_END
