#pragma once

#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

NS_ASSUME_NONNULL_BEGIN

// Answers leandoc://app/ for one window: reader assets from the bundle's
// Resources/assets, and leandoc://app/pkg/<tab>/<generation>/document.docx
// from the window's sanitized package in memory. Anything else is a 404.
typedef NSData *_Nullable (^LDPackageProvider)(NSUInteger tab, NSUInteger generation);

@interface LDSchemeHandler : NSObject <WKURLSchemeHandler>

- (instancetype)initWithAssetRoot:(NSURL *)assetRoot
                  packageProvider:(LDPackageProvider)packageProvider NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@end

NS_ASSUME_NONNULL_END
