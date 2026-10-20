#import "LDSchemeHandler.h"

#include "core/DocCore.h"

#include <filesystem>

namespace {

constexpr unsigned long long kMaximumAssetBytes = 64ULL * 1024ULL * 1024ULL;
NSString *const LDAppOrigin = @"leandoc://app";

NSDictionary<NSString *, NSString *> *AssetTypes(void) {
    static NSDictionary<NSString *, NSString *> *types;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      types = @{
          @"html" : @"text/html",
          @"css" : @"text/css",
          @"js" : @"text/javascript",
          @"mjs" : @"text/javascript",
          @"json" : @"application/json",
          @"woff2" : @"font/woff2",
          @"woff" : @"font/woff",
          @"ttf" : @"font/ttf",
          @"svg" : @"image/svg+xml",
          @"png" : @"image/png",
      };
    });
    return types;
}

BOOL ParseDecimal(NSString *text, NSUInteger *value) {
    if (text.length == 0 || text.length > 9 || [text hasPrefix:@"0"]) {
        return NO;
    }
    NSUInteger parsed = 0;
    for (NSUInteger index = 0; index < text.length; ++index) {
        const unichar digit = [text characterAtIndex:index];
        if (digit < '0' || digit > '9') {
            return NO;
        }
        parsed = parsed * 10 + static_cast<NSUInteger>(digit - '0');
    }
    *value = parsed;
    return YES;
}

// The decoded path below the origin, or nil for anything unexpected: another
// origin, NUL, a backslash, or a dot segment.
NSString *RelativePath(NSURL *URL) {
    if (![URL.scheme.lowercaseString isEqualToString:@"leandoc"] ||
        ![URL.host.lowercaseString isEqualToString:@"app"] || URL.port != nil) {
        return nil;
    }
    NSURLComponents *components = [NSURLComponents componentsWithURL:URL resolvingAgainstBaseURL:NO];
    NSString *encoded = components.percentEncodedPath;
    if (encoded == nil || [encoded.lowercaseString containsString:@"%00"]) {
        return nil;
    }
    NSString *decoded = encoded.stringByRemovingPercentEncoding;
    if (decoded == nil || ![decoded hasPrefix:@"/"] || [decoded containsString:@"\\"]) {
        return nil;
    }
    decoded = [decoded substringFromIndex:1];
    for (NSString *segment in [decoded componentsSeparatedByString:@"/"]) {
        if ([segment isEqualToString:@"."] || [segment isEqualToString:@".."]) {
            return nil;
        }
    }
    return decoded;
}

NSHTTPURLResponse *Response(NSURL *URL, NSInteger status, NSString *type, NSUInteger length) {
    NSDictionary<NSString *, NSString *> *headers = @{
        @"Content-Type" : type,
        @"Content-Length" : [NSString stringWithFormat:@"%lu", static_cast<unsigned long>(length)],
        @"Cache-Control" : @"no-store",
        @"X-Content-Type-Options" : @"nosniff",
        // Fetches and fonts may be treated as CORS requests on a custom
        // scheme; only the app origin itself is named, never "*".
        @"Access-Control-Allow-Origin" : LDAppOrigin,
    };
    return [[NSHTTPURLResponse alloc] initWithURL:URL
                                       statusCode:status
                                      HTTPVersion:@"HTTP/1.1"
                                     headerFields:headers];
}

}  // namespace

@implementation LDSchemeHandler {
    NSURL *_assetRoot;
    LDPackageProvider _packageProvider;
}

- (instancetype)initWithAssetRoot:(NSURL *)assetRoot
                  packageProvider:(LDPackageProvider)packageProvider {
    self = [super init];
    if (self != nil) {
        _assetRoot = assetRoot.URLByResolvingSymlinksInPath;
        _packageProvider = [packageProvider copy];
    }
    return self;
}

- (NSData *)assetForPath:(NSString *)relative type:(NSString **)type {
    NSString *mime = AssetTypes()[relative.pathExtension.lowercaseString];
    if (relative.length == 0 || mime == nil) {
        return nil;
    }
    NSURL *candidate = [[_assetRoot URLByAppendingPathComponent:relative] URLByStandardizingPath];
    candidate = candidate.URLByResolvingSymlinksInPath;
    if (!leandoc::core::IsPathWithin(std::filesystem::path(_assetRoot.fileSystemRepresentation),
                                     std::filesystem::path(candidate.fileSystemRepresentation))) {
        return nil;
    }
    NSNumber *regular = nil;
    NSNumber *size = nil;
    if (![candidate getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil] ||
        !regular.boolValue ||
        ![candidate getResourceValue:&size forKey:NSURLFileSizeKey error:nil] ||
        size.unsignedLongLongValue > kMaximumAssetBytes) {
        return nil;
    }
    *type = mime;
    return [NSData dataWithContentsOfURL:candidate options:NSDataReadingMappedIfSafe error:nil];
}

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    (void)webView;
    NSURL *URL = task.request.URL;
    NSString *relative = RelativePath(URL);
    NSString *method = task.request.HTTPMethod;
    NSData *body = nil;
    NSString *type = @"text/plain";
    if (relative != nil && (method == nil || [method isEqualToString:@"GET"])) {
        NSArray<NSString *> *parts = [relative componentsSeparatedByString:@"/"];
        NSUInteger tab = 0;
        NSUInteger generation = 0;
        if (parts.count == 4 && [parts[0] isEqualToString:@"pkg"] &&
            ParseDecimal(parts[1], &tab) && ParseDecimal(parts[2], &generation) &&
            [parts[3] isEqualToString:@"document.docx"]) {
            body = _packageProvider(tab, generation);
            type = @"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        } else if (![parts[0] isEqualToString:@"pkg"]) {
            NSString *assetType = nil;
            body = [self assetForPath:relative type:&assetType];
            if (assetType != nil) {
                type = assetType;
            }
        }
    }
    if (body == nil) {
        [task didReceiveResponse:Response(URL, 404, @"text/plain", 0)];
        [task didReceiveData:[NSData data]];
        [task didFinish];
        return;
    }
    [task didReceiveResponse:Response(URL, 200, type, body.length)];
    [task didReceiveData:body];
    [task didFinish];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {
    (void)webView;
    (void)task;
}

@end
