#pragma once

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// The "Open in ..." editor, resolved once per launch in SPEC order: Microsoft
// Word, LibreOffice, Pages, the default app for .docx when it is not LeanDoc,
// then Word for the web in the browser.
@interface LDEditor : NSObject

@property(nonatomic, readonly, copy) NSString *kind;   // word, libreoffice, pages, default, web
@property(nonatomic, readonly, copy) NSString *label;  // shown on the reader's button
@property(nonatomic, readonly, nullable) NSURL *applicationURL;

+ (LDEditor *)shared;

// Opens fileURL in the editor. The completion handler receives a status
// message for the reader, or nil when nothing needs to be said.
- (void)openFileURL:(NSURL *)fileURL
         completion:(void (^)(NSString *_Nullable message, NSString *tone))completion;

@end

NS_ASSUME_NONNULL_END
