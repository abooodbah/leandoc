#import "LDDocumentWindowController.h"

#import "LDAppDelegate.h"
#import "LDDocument.h"
#import "LDEditor.h"
#import "LDSchemeHandler.h"
#import "LDTiming.h"

#import <WebKit/WebKit.h>

#include "leandoc-version.h"
#include "core/Links.h"

#include <optional>

namespace {

NSString *const LDThemeKey = @"LeanDocTheme";
NSString *const LDViewKey = @"LeanDocView";
NSString *const LDReaderURLString = @"leandoc://app/reader.html";
constexpr NSUInteger kMaximumMessageLength = 65536;

NSString *CurrentTheme(void) {
    NSString *theme = [NSUserDefaults.standardUserDefaults stringForKey:LDThemeKey];
    if ([theme isEqualToString:@"light"] || [theme isEqualToString:@"dark"]) {
        return theme;
    }
    return @"system";
}

NSString *CurrentView(void) {
    NSString *view = [NSUserDefaults.standardUserDefaults stringForKey:LDViewKey];
    return [view isEqualToString:@"reading"] ? @"reading" : @"page";
}

BOOL IsAppURL(NSURL *URL) {
    return [URL.scheme.lowercaseString isEqualToString:@"leandoc"] &&
           [URL.host.lowercaseString isEqualToString:@"app"] && URL.port == nil;
}

BOOL ContainsNUL(NSString *value) {
    const unichar nul = 0;
    return [value rangeOfString:[NSString stringWithCharacters:&nul length:1]].location !=
           NSNotFound;
}

NSString *StringValue(NSDictionary *message, NSString *key) {
    id value = message[key];
    return [value isKindOfClass:NSString.class] ? value : nil;
}

// A non-negative whole number that fits in 32 bits, or nil.
NSNumber *UnsignedValue(NSDictionary *message, NSString *key) {
    id value = message[key];
    if (![value isKindOfClass:NSNumber.class]) {
        return nil;
    }
    const double number = [value doubleValue];
    if (number < 0 || number > 4294967295.0 ||
        number != static_cast<double>(static_cast<unsigned long long>(number))) {
        return nil;
    }
    return @(static_cast<unsigned long long>(number));
}

LDAppDelegate *Delegate(void) {
    id delegate = NSApp.delegate;
    return [delegate isKindOfClass:LDAppDelegate.class] ? delegate : nil;
}

}  // namespace

// WKUserContentController keeps its handler alive; this proxy keeps the
// window controller from being retained by its own web view.
@interface LDWeakScriptMessageHandler : NSObject <WKScriptMessageHandler>
@property(nonatomic, weak) id<WKScriptMessageHandler> delegate;
@end

@implementation LDWeakScriptMessageHandler
- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    [self.delegate userContentController:userContentController didReceiveScriptMessage:message];
}
@end

// The page's context menu keeps only copy and text-editing items. WebKit's
// own items such as "Download Linked File", "Open Link", and "Open Image in
// New Window" would fetch what the document points to.
static BOOL LDIsAllowedMenuItem(NSMenuItem *item) {
    if (item.isSeparatorItem) {
        return YES;
    }
    if (item.hasSubmenu) {
        return NO;
    }
    static NSSet<NSString *> *allowedIdentifiers;
    static NSSet<NSString *> *allowedActions;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      allowedIdentifiers = [NSSet setWithArray:@[
          @"WKMenuItemIdentifierCopy", @"WKMenuItemIdentifierCopyLink",
          @"WKMenuItemIdentifierPaste"
      ]];
      allowedActions = [NSSet setWithArray:@[
          @"cut:", @"copy:", @"paste:", @"pasteAsPlainText:", @"selectAll:", @"delete:"
      ]];
    });
    if (item.identifier != nil && [allowedIdentifiers containsObject:item.identifier]) {
        return YES;
    }
    return item.action != nullptr &&
           [allowedActions containsObject:NSStringFromSelector(item.action)];
}

@interface LDReaderWebView : WKWebView
@end

@implementation LDReaderWebView
- (void)willOpenMenu:(NSMenu *)menu withEvent:(NSEvent *)event {
    [super willOpenMenu:menu withEvent:event];
    for (NSMenuItem *item in [menu.itemArray copy]) {
        if (!LDIsAllowedMenuItem(item)) {
            [menu removeItem:item];
        }
    }
    // Drop separators left at either end or doubled up.
    BOOL previousSeparator = YES;
    for (NSMenuItem *item in [menu.itemArray copy]) {
        if (item.isSeparatorItem && previousSeparator) {
            [menu removeItem:item];
            continue;
        }
        previousSeparator = item.isSeparatorItem;
    }
    if (menu.itemArray.lastObject.isSeparatorItem) {
        [menu removeItem:menu.itemArray.lastObject];
    }
}
@end

@interface LDDocumentWindowController () <WKNavigationDelegate, WKUIDelegate,
                                          WKScriptMessageHandler> {
    WKWebView *_webView;
    LDSchemeHandler *_schemeHandler;
    LDWeakScriptMessageHandler *_messageProxy;
    BOOL _readerReady;
    BOOL _windowShown;
    void (^_smokeCompletion)(BOOL, NSString *);
    BOOL _smokeRendered;
    NSUInteger _smokeRenderMs;
}
@end

@implementation LDDocumentWindowController

- (instancetype)initWithDocument:(LDDocument *)document {
    NSRect frame = NSMakeRect(0, 0, 1120, 820);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                              NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                   styleMask:style
                                                     backing:NSBackingStoreBuffered
                                                       defer:NO];
    window.title = @"LeanDoc";
    window.minSize = NSMakeSize(640, 480);
    // Documents group as system window tabs, which is LeanDoc's tab strip on
    // macOS; the reader's own strip stays hidden.
    window.tabbingMode = NSWindowTabbingModePreferred;
    window.tabbingIdentifier = @"io.github.abooodbah.LeanDoc.reader";

    self = [super initWithWindow:window];
    if (self != nil) {
        [self configureWebViewForDocument:document];
        [self applyWindowTheme:CurrentTheme()];
        [window center];
    }
    return self;
}

- (LDDocument *)leanDocDocument {
    return (LDDocument *)self.document;
}

- (void)configureWebViewForDocument:(LDDocument *)document {
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = NO;
    if (@available(macOS 12.3, *)) {
        configuration.preferences.elementFullscreenEnabled = NO;
    }

    NSURL *assetRoot = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"assets"
                                                                        isDirectory:YES];
    NSString *overrideRoot = NSProcessInfo.processInfo.environment[@"LEANDOC_ASSETS_DIR"];
    if (overrideRoot.length > 0) {
        assetRoot = [NSURL fileURLWithPath:overrideRoot isDirectory:YES];
    }
    // The package provider asks the document, which answers only for its
    // current tab id and generation.
    __weak LDDocument *weakDocument = document;
    _schemeHandler = [[LDSchemeHandler alloc]
        initWithAssetRoot:assetRoot
          packageProvider:^NSData *(NSUInteger tab, NSUInteger generation) {
            LDDocument *strongDocument = weakDocument;
            NSData *package = [strongDocument packageForTab:tab generation:generation];
            if (package != nil && LDTimingEnabled()) {
                LDTraceTiming(@"package-served",
                              [NSString stringWithFormat:@"tab=%lu generation=%lu coreMs=%lu bytes=%lu",
                                                         static_cast<unsigned long>(tab),
                                                         static_cast<unsigned long>(generation),
                                                         static_cast<unsigned long>(
                                                             strongDocument.lastCoreMilliseconds),
                                                         static_cast<unsigned long>(package.length)]);
            }
            return package;
          }];
    [configuration setURLSchemeHandler:_schemeHandler forURLScheme:@"leandoc"];

    _messageProxy = [[LDWeakScriptMessageHandler alloc] init];
    _messageProxy.delegate = self;
    [configuration.userContentController addScriptMessageHandler:_messageProxy name:@"leandoc"];

    if (Delegate().smokeTesting) {
        // The smoke check counts Content Security Policy violations from the
        // first script onwards.
        WKUserScript *probe = [[WKUserScript alloc]
              initWithSource:@"window.__leandocCspViolations = 0;"
                             @"document.addEventListener('securitypolicyviolation', function () {"
                             @"  window.__leandocCspViolations += 1; });"
               injectionTime:WKUserScriptInjectionTimeAtDocumentStart
            forMainFrameOnly:YES];
        [configuration.userContentController addUserScript:probe];
    }

    _webView = [[LDReaderWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    _webView.translatesAutoresizingMaskIntoConstraints = NO;
    _webView.navigationDelegate = self;
    _webView.UIDelegate = self;
    _webView.allowsMagnification = NO;
    _webView.allowsBackForwardNavigationGestures = NO;
    if (@available(macOS 13.3, *)) {
        _webView.inspectable = NO;
    }

    NSView *contentView = self.window.contentView;
    [contentView addSubview:_webView];
    [NSLayoutConstraint activateConstraints:@[
        [_webView.leadingAnchor constraintEqualToAnchor:contentView.leadingAnchor],
        [_webView.trailingAnchor constraintEqualToAnchor:contentView.trailingAnchor],
        [_webView.topAnchor constraintEqualToAnchor:contentView.topAnchor],
        [_webView.bottomAnchor constraintEqualToAnchor:contentView.bottomAnchor],
    ]];

    [self loadReader];
}

- (void)loadReader {
    _readerReady = NO;
    NSURL *readerURL = [NSURL URLWithString:LDReaderURLString];
    [_webView loadRequest:[NSURLRequest requestWithURL:readerURL
                                           cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                       timeoutInterval:15.0]];
}

- (void)dealloc {
    [_webView.configuration.userContentController removeScriptMessageHandlerForName:@"leandoc"];
    _webView.navigationDelegate = nil;
    _webView.UIDelegate = nil;
}

- (void)showWindow:(id)sender {
    [super showWindow:sender];
    if (!_windowShown) {
        _windowShown = YES;
        LDTraceTiming(@"window-visible", nil);
    }
}

- (void)windowDidLoad {
    [super windowDidLoad];
    [self updateTitle];
}

- (void)updateTitle {
    NSString *name = self.leanDocDocument.hasSourceFile ? self.leanDocDocument.displayName : nil;
    self.window.title = name.length > 0 ? name : @"LeanDoc";
}

#pragma mark - Host to reader

- (void)deliver:(NSDictionary<NSString *, id> *)payload {
    if (!_readerReady) {
        return;
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    NSString *json = data == nil ? nil : [[NSString alloc] initWithData:data
                                                               encoding:NSUTF8StringEncoding];
    if (json == nil) {
        return;
    }
    // The message travels as JSON text and is parsed in the page, so numbers
    // and booleans keep their JSON types.
    [_webView callAsyncJavaScript:@"window.dispatchEvent(new CustomEvent('leandoc-message', "
                                  @"{detail: JSON.parse(payload)}))"
                        arguments:@{@"payload" : json}
                          inFrame:nil
                   inContentWorld:WKContentWorld.pageWorld
                completionHandler:^(id result, NSError *error) {
                  (void)result;
                  if (error != nil) {
                      NSLog(@"LeanDoc could not deliver a message to its reader: %@", error);
                  }
                }];
}

- (void)sendHost {
    LDEditor *editor = LDEditor.shared;
    [self deliver:@{
        @"type" : @"host",
        @"platform" : @"macos",
        @"version" : @LEANDOC_VERSION_STRING,
        @"editor" : @{@"kind" : editor.kind, @"label" : editor.label},
        @"tabs" : @NO,
    }];
}

- (void)sendTheme {
    [self deliver:@{@"type" : @"theme", @"theme" : CurrentTheme(), @"view" : CurrentView()}];
}

- (void)sendCurrentDocument {
    if (!_readerReady) {
        return;
    }
    NSDictionary<NSString *, id> *payload = [self.leanDocDocument readerPayload];
    [self deliver:payload];
    if (_smokeCompletion != nil && ![payload[@"type"] isEqualToString:@"document"]) {
        [self finishSmoke:NO detail:@"the smoke fixture did not produce a renderable package"];
    }
}

- (void)documentContentDidChange {
    [self updateTitle];
    [self sendCurrentDocument];
}

- (void)showStatus:(NSString *)message tone:(NSString *)tone {
    [self deliver:@{@"type" : @"status", @"message" : message, @"tone" : tone}];
}

#pragma mark - Reader to host

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    (void)userContentController;
    if (!message.frameInfo.isMainFrame || !IsAppURL(message.frameInfo.request.URL) ||
        ![message.body isKindOfClass:NSString.class]) {
        return;
    }
    NSString *text = (NSString *)message.body;
    if (text.length == 0 || text.length > kMaximumMessageLength || ContainsNUL(text)) {
        return;
    }
    id parsed = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding]
                                                options:0
                                                  error:nil];
    if (![parsed isKindOfClass:NSDictionary.class]) {
        return;
    }
    NSDictionary *body = parsed;
    NSString *type = StringValue(body, @"type");
    if (type == nil) {
        return;
    }
    if ([type isEqualToString:@"ready"]) {
        LDTraceTiming(@"webview-ready", nil);
        _readerReady = YES;
        [self sendHost];
        [self sendTheme];
        [self sendCurrentDocument];
        return;
    }
    if (!_readerReady) {
        return;
    }
    if ([type isEqualToString:@"rendered"] || [type isEqualToString:@"renderFailed"]) {
        [self handleRendered:body failed:[type isEqualToString:@"renderFailed"]];
    } else if ([type isEqualToString:@"open"]) {
        [NSDocumentController.sharedDocumentController openDocument:nil];
    } else if ([type isEqualToString:@"openRecent"]) {
        NSString *path = StringValue(body, @"path");
        if (path != nil && [[LDDocument recentPaths] containsObject:path]) {
            [Delegate() openURL:[NSURL fileURLWithPath:path]];
        }
    } else if ([type isEqualToString:@"clearRecent"]) {
        [LDDocument clearRecent];
        if (!self.leanDocDocument.hasSourceFile) {
            [self sendCurrentDocument];
        }
    } else if ([type isEqualToString:@"openInEditor"]) {
        [self openInEditor];
    } else if ([type isEqualToString:@"link"]) {
        [self handleLink:StringValue(body, @"href")];
    } else if ([type isEqualToString:@"setTheme"]) {
        NSString *theme = StringValue(body, @"theme");
        if ([theme isEqualToString:@"system"] || [theme isEqualToString:@"light"] ||
            [theme isEqualToString:@"dark"]) {
            [self storeTheme:theme];
        }
    } else if ([type isEqualToString:@"setView"]) {
        NSString *view = StringValue(body, @"view");
        if ([view isEqualToString:@"page"] || [view isEqualToString:@"reading"]) {
            [NSUserDefaults.standardUserDefaults setObject:view forKey:LDViewKey];
        }
    } else if ([type isEqualToString:@"reload"]) {
        [self.leanDocDocument reloadFromDisk];
    }
    // selectTab and closeTab do not arrive: macOS uses system window tabs.
}

- (void)handleRendered:(NSDictionary *)body failed:(BOOL)failed {
    NSNumber *tab = UnsignedValue(body, @"tab");
    NSNumber *generation = UnsignedValue(body, @"generation");
    LDDocument *document = self.leanDocDocument;
    // A message for an older generation describes a view that is gone.
    if (tab == nil || generation == nil || tab.unsignedIntegerValue != document.tabId ||
        generation.unsignedIntegerValue != document.generation) {
        return;
    }
    if (failed) {
        if (_smokeCompletion != nil) {
            [self finishSmoke:NO
                       detail:[@"the reader reported renderFailed: "
                                  stringByAppendingString:StringValue(body, @"message") ?: @""]];
        }
        return;
    }
    NSNumber *pages = UnsignedValue(body, @"pages");
    NSNumber *milliseconds = UnsignedValue(body, @"ms");
    if (LDTimingEnabled()) {
        LDTraceTiming(@"rendered",
                      [NSString stringWithFormat:@"tab=%@ generation=%@ pages=%@ readerMs=%@", tab,
                                                 generation, pages ?: @0, milliseconds ?: @0]);
    }
    [Delegate() documentDidRender];
    if (_smokeCompletion != nil && !_smokeRendered) {
        _smokeRendered = YES;
        _smokeRenderMs = milliseconds.unsignedIntegerValue;
        [self probeSmokeDOM];
    }
}

- (void)openInEditor {
    LDDocument *document = self.leanDocDocument;
    if (!document.hasSourceFile || document.fileURL == nil) {
        return;
    }
    __weak LDDocumentWindowController *weakSelf = self;
    [LDEditor.shared openFileURL:document.fileURL
                      completion:^(NSString *message, NSString *tone) {
                        if (message != nil) {
                            [weakSelf showStatus:message tone:tone];
                        }
                      }];
}

- (void)handleLink:(NSString *)href {
    if (href.length == 0 || href.length > 8192 || ContainsNUL(href)) {
        return;
    }
    // The same rule as every host (src/core/Links.h): http and https with a
    // host, and mailto with only its addresses, subject, body, cc, and bcc.
    const char *utf8 = href.UTF8String;
    const auto normalized =
        utf8 == nullptr ? std::nullopt : leandoc::core::NormalizeExternalLink(utf8);
    NSURL *URL = normalized ? [NSURL URLWithString:@(normalized->c_str())] : nil;
    if (URL == nil) {
        [self showStatus:@"LeanDoc opens web and email links only." tone:@"warning"];
        return;
    }
    if (![NSWorkspace.sharedWorkspace openURL:URL]) {
        [self showStatus:@"macOS could not open that link." tone:@"error"];
    }
}

- (void)storeTheme:(NSString *)theme {
    [NSUserDefaults.standardUserDefaults setObject:theme forKey:LDThemeKey];
    // Every window follows the same theme, as on Windows and Linux.
    for (NSWindow *window in NSApp.windows) {
        id controller = window.windowController;
        if ([controller isKindOfClass:LDDocumentWindowController.class]) {
            [controller applyWindowTheme:theme];
            [controller sendTheme];
        }
    }
}

- (void)cycleTheme {
    NSString *theme = CurrentTheme();
    NSString *next = [theme isEqualToString:@"system"]
                         ? @"light"
                         : ([theme isEqualToString:@"light"] ? @"dark" : @"system");
    [self storeTheme:next];
}

- (void)applyWindowTheme:(NSString *)theme {
    if ([theme isEqualToString:@"dark"]) {
        self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    } else if ([theme isEqualToString:@"light"]) {
        self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    } else {
        self.window.appearance = nil;
    }
}

#pragma mark - Smoke test

- (void)runSmokeCheckWithCompletion:(void (^)(BOOL success, NSString *detail))completion {
    _smokeCompletion = [completion copy];
    if (_readerReady && ![[self.leanDocDocument readerPayload][@"type"]
                            isEqualToString:@"document"]) {
        [self finishSmoke:NO detail:@"the smoke fixture did not produce a renderable package"];
    }
}

- (void)finishSmoke:(BOOL)success detail:(NSString *)detail {
    void (^completion)(BOOL, NSString *) = _smokeCompletion;
    _smokeCompletion = nil;
    if (completion != nil) {
        completion(success, detail);
    }
}

- (void)probeSmokeDOM {
    // A page exists in the DOM and has text, no resource came from outside the
    // app origin, and the Content Security Policy reported nothing.
    NSString *script =
        @"(function () {"
         "  var root = document.documentElement;"
         "  var origin = location.protocol + '//' + location.host + '/';"
         "  var pages = Math.min(document.querySelectorAll('section.docx').length,"
         "    parseInt(root.dataset.pages || '0', 10) || 0);"
         "  var text = (document.body ? document.body.innerText : '').trim().length;"
         "  var offOrigin = performance.getEntriesByType('resource').filter(function (entry) {"
         "    return entry.name.indexOf(origin) !== 0 && !/^(blob|data):/i.test(entry.name);"
         "  }).length;"
         "  return JSON.stringify({state: root.dataset.renderState || '', pages: pages,"
         "    text: text, offOrigin: offOrigin, csp: window.__leandocCspViolations || 0});"
         "}())";
    [_webView evaluateJavaScript:script
               completionHandler:^(id result, NSError *error) {
                 if (error != nil || ![result isKindOfClass:NSString.class]) {
                     [self finishSmoke:NO
                                detail:error.localizedDescription ?: @"the DOM probe returned nothing"];
                     return;
                 }
                 NSString *summary = result;
                 NSDictionary *values = [NSJSONSerialization
                     JSONObjectWithData:[summary dataUsingEncoding:NSUTF8StringEncoding]
                                options:0
                                  error:nil];
                 const BOOL success = [values isKindOfClass:NSDictionary.class] &&
                                      [values[@"state"] isEqual:@"ready"] &&
                                      [values[@"pages"] integerValue] >= 1 &&
                                      [values[@"text"] integerValue] > 0 &&
                                      [values[@"offOrigin"] integerValue] == 0 &&
                                      [values[@"csp"] integerValue] == 0;
                 [self finishSmoke:success
                            detail:[NSString stringWithFormat:@"%@ renderMs=%lu", summary,
                                                              static_cast<unsigned long>(
                                                                  self->_smokeRenderMs)]];
               }];
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    (void)webView;
    NSURL *URL = navigationAction.request.URL;
    // Only the reader page itself may load in the main frame; the page never
    // navigates anywhere else, and subframes are refused by its CSP.
    const BOOL reader = IsAppURL(URL) && [URL.path isEqualToString:@"/reader.html"];
    const BOOL blank = [URL.absoluteString isEqualToString:@"about:blank"];
    decisionHandler(reader || blank ? WKNavigationActionPolicyAllow
                                    : WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
                      decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    (void)webView;
    const BOOL allow = IsAppURL(navigationResponse.response.URL) &&
                       navigationResponse.canShowMIMEType;
    decisionHandler(allow ? WKNavigationResponsePolicyAllow : WKNavigationResponsePolicyCancel);
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    (void)webView;
    if (_smokeCompletion != nil) {
        [self finishSmoke:NO detail:@"the WebKit web content process exited"];
        return;
    }
    [self.leanDocDocument reloadFromDisk];
    [self loadReader];
}

#pragma mark - WKUIDelegate

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
    (void)webView;
    (void)configuration;
    (void)navigationAction;
    (void)windowFeatures;
    return nil;
}

- (void)webView:(WKWebView *)webView
    runJavaScriptAlertPanelWithMessage:(NSString *)message
                      initiatedByFrame:(WKFrameInfo *)frame
                     completionHandler:(void (^)(void))completionHandler {
    (void)webView;
    (void)message;
    (void)frame;
    completionHandler();
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                        initiatedByFrame:(WKFrameInfo *)frame
                       completionHandler:(void (^)(BOOL result))completionHandler {
    (void)webView;
    (void)message;
    (void)frame;
    completionHandler(NO);
}

- (void)webView:(WKWebView *)webView
    runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt
                              defaultText:(NSString *)defaultText
                         initiatedByFrame:(WKFrameInfo *)frame
                        completionHandler:(void (^)(NSString *result))completionHandler {
    (void)webView;
    (void)prompt;
    (void)defaultText;
    (void)frame;
    completionHandler(nil);
}

- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
              initiatedByFrame:(WKFrameInfo *)frame
             completionHandler:(void (^)(NSArray<NSURL *> *URLs))completionHandler {
    (void)webView;
    (void)parameters;
    (void)frame;
    completionHandler(nil);
}

- (void)webView:(WKWebView *)webView
    requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin
                          initiatedByFrame:(WKFrameInfo *)frame
                                      type:(WKMediaCaptureType)type
                           decisionHandler:(void (^)(WKPermissionDecision decision))decisionHandler {
    (void)webView;
    (void)origin;
    (void)frame;
    (void)type;
    decisionHandler(WKPermissionDecisionDeny);
}

@end
