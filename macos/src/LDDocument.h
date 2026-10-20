#pragma once

#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

extern NSString *const LDDocumentTypeName;

// One read-only document per window. The document keeps the sanitized
// package of its file, which is the only document data the host holds.
@interface LDDocument : NSDocument

@property(nonatomic, readonly) BOOL hasSourceFile;
@property(nonatomic, readonly) NSUInteger tabId;
@property(nonatomic, readonly) NSUInteger generation;

// The message for the reader: "document", "fallback", or "empty".
- (NSDictionary<NSString *, id> *)readerPayload;
// The package for leandoc://app/pkg/<tab>/<generation>/document.docx, or nil.
- (nullable NSData *)packageForTab:(NSUInteger)tab generation:(NSUInteger)generation;
- (void)reloadFromDisk;

@end

NS_ASSUME_NONNULL_END
