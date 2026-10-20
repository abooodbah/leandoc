#import "LDAppDelegate.h"

#import "LDDocument.h"
#import "LDDocumentWindowController.h"
#import "LDTiming.h"

#include <cstdio>
#include <cstdlib>

namespace {

NSMenuItem *MenuItem(NSString *title, SEL action, NSString *keyEquivalent, id target) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                 action:action
                                          keyEquivalent:keyEquivalent];
    item.target = target;
    return item;
}

}  // namespace

@interface LDAppDelegate () {
    BOOL _smokeTesting;
    NSString *_smokePath;
    NSArray<NSString *> *_commandLinePaths;
    long _exitAfterRenderMs;
    BOOL _renderSeen;
}
@end

@implementation LDAppDelegate

- (instancetype)init {
    self = [super init];
    if (self != nil) {
        _exitAfterRenderMs = -1;
        [self parseCommandLine];
    }
    return self;
}

- (BOOL)smokeTesting {
    return _smokeTesting;
}

- (long)exitAfterRenderMs {
    return _exitAfterRenderMs;
}

- (void)parseCommandLine {
    NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
    NSMutableArray<NSString *> *paths = [NSMutableArray array];
    BOOL pathsOnly = NO;
    for (NSUInteger index = 1; index < arguments.count; ++index) {
        NSString *argument = arguments[index];
        if (!pathsOnly && [argument isEqualToString:@"--smoke-test"] &&
            index + 1 < arguments.count) {
            _smokeTesting = YES;
            _smokePath = arguments[++index];
            continue;
        }
        if (!pathsOnly && [argument isEqualToString:@"--"]) {
            pathsOnly = YES;
            continue;
        }
        if (!pathsOnly && [argument hasPrefix:@"--exit-after-render="]) {
            _exitAfterRenderMs = LDParseExitAfterRender(argument);
            continue;
        }
        if (!pathsOnly && [argument hasPrefix:@"-"]) {
            // --trace-timing, and AppKit's own -Key value pairs, which
            // NSUserDefaults reads itself.
            if (![argument hasPrefix:@"--"] && index + 1 < arguments.count) {
                ++index;
            }
            continue;
        }
        [paths addObject:argument];
    }
    _commandLinePaths = [paths copy];
}

- (void)installMainMenu {
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

    NSMenuItem *applicationRoot = [[NSMenuItem alloc] initWithTitle:@"LeanDoc"
                                                            action:nil
                                                     keyEquivalent:@""];
    NSMenu *applicationMenu = [[NSMenu alloc] initWithTitle:@"LeanDoc"];
    [applicationMenu addItem:MenuItem(@"About LeanDoc",
                                      @selector(orderFrontStandardAboutPanel:), @"", NSApp)];
    [applicationMenu addItem:NSMenuItem.separatorItem];
    NSMenuItem *services = [[NSMenuItem alloc] initWithTitle:@"Services"
                                                     action:nil
                                              keyEquivalent:@""];
    services.submenu = [[NSMenu alloc] initWithTitle:@"Services"];
    NSApp.servicesMenu = services.submenu;
    [applicationMenu addItem:services];
    [applicationMenu addItem:NSMenuItem.separatorItem];
    [applicationMenu addItem:MenuItem(@"Hide LeanDoc", @selector(hide:), @"h", NSApp)];
    NSMenuItem *hideOthers =
        MenuItem(@"Hide Others", @selector(hideOtherApplications:), @"h", NSApp);
    hideOthers.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagOption;
    [applicationMenu addItem:hideOthers];
    [applicationMenu addItem:MenuItem(@"Show All", @selector(unhideAllApplications:), @"", NSApp)];
    [applicationMenu addItem:NSMenuItem.separatorItem];
    [applicationMenu addItem:MenuItem(@"Quit LeanDoc", @selector(terminate:), @"q", NSApp)];
    applicationRoot.submenu = applicationMenu;
    [mainMenu addItem:applicationRoot];

    // The reader handles its own shortcuts (find, zoom, theme, view, editor)
    // with Command on macOS, so the menus only add what AppKit must own.
    NSMenuItem *fileRoot = [[NSMenuItem alloc] initWithTitle:@"File" action:nil keyEquivalent:@""];
    NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"File"];
    [fileMenu addItem:MenuItem(@"Open…", @selector(openDocument:), @"o",
                               NSDocumentController.sharedDocumentController)];
    [fileMenu addItem:NSMenuItem.separatorItem];
    [fileMenu addItem:MenuItem(@"Close", @selector(performClose:), @"w", nil)];
    fileRoot.submenu = fileMenu;
    [mainMenu addItem:fileRoot];

    NSMenuItem *editRoot = [[NSMenuItem alloc] initWithTitle:@"Edit" action:nil keyEquivalent:@""];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItem:MenuItem(@"Copy", @selector(copy:), @"c", nil)];
    [editMenu addItem:MenuItem(@"Select All", @selector(selectAll:), @"a", nil)];
    editRoot.submenu = editMenu;
    [mainMenu addItem:editRoot];

    NSMenuItem *windowRoot = [[NSMenuItem alloc] initWithTitle:@"Window"
                                                       action:nil
                                                keyEquivalent:@""];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
    [windowMenu addItem:MenuItem(@"Minimize", @selector(performMiniaturize:), @"m", nil)];
    [windowMenu addItem:MenuItem(@"Zoom", @selector(performZoom:), @"", nil)];
    [windowMenu addItem:NSMenuItem.separatorItem];
    [windowMenu addItem:MenuItem(@"Bring All to Front", @selector(arrangeInFront:), @"", NSApp)];
    windowRoot.submenu = windowMenu;
    NSApp.windowsMenu = windowMenu;
    [mainMenu addItem:windowRoot];

    NSApp.mainMenu = mainMenu;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    if (_smokeTesting) {
        NSApp.activationPolicy = NSApplicationActivationPolicyAccessory;
        [self beginSmokeTest];
        return;
    }
    [NSApp activateIgnoringOtherApps:YES];

    if (_commandLinePaths.count > 0) {
        for (NSString *path in _commandLinePaths) {
            [self openURL:[NSURL fileURLWithPath:path]];
        }
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      if (NSDocumentController.sharedDocumentController.documents.count == 0) {
          [self openWelcomeWindow];
      }
    });
}

- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)URLs {
    (void)application;
    if (_smokeTesting) {
        return;
    }
    for (NSURL *URL in URLs) {
        [self openURL:URL];
    }
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    (void)sender;
    if (!flag) {
        NSArray<NSDocument *> *documents = NSDocumentController.sharedDocumentController.documents;
        if (documents.count == 0) {
            [self openWelcomeWindow];
        } else {
            for (NSDocument *document in documents) {
                [document showWindows];
            }
        }
    }
    return YES;
}

- (BOOL)applicationShouldOpenUntitledFile:(NSApplication *)sender {
    (void)sender;
    return NO;
}

- (BOOL)applicationSupportsSecureRestorableState:(NSApplication *)app {
    (void)app;
    return YES;
}

- (void)openWelcomeWindow {
    LDDocument *document = [[LDDocument alloc] init];
    [NSDocumentController.sharedDocumentController addDocument:document];
    [document makeWindowControllers];
    [document showWindows];
}

- (void)closeWelcomeDocuments {
    for (NSDocument *document in [NSDocumentController.sharedDocumentController.documents copy]) {
        if ([document isKindOfClass:LDDocument.class] && ![(LDDocument *)document hasSourceFile]) {
            [document close];
        }
    }
}

- (void)openURL:(NSURL *)URL {
    [NSDocumentController.sharedDocumentController
        openDocumentWithContentsOfURL:URL
                              display:YES
                    completionHandler:^(NSDocument *document, BOOL wasOpen, NSError *error) {
                      (void)wasOpen;
                      if (error != nil || document == nil) {
                          if (error != nil) {
                              [NSApp presentError:error];
                          }
                          if (NSDocumentController.sharedDocumentController.documents.count == 0) {
                              [self openWelcomeWindow];
                          }
                          return;
                      }
                      [self closeWelcomeDocuments];
                    }];
}

- (void)documentDidRender {
    if (_renderSeen) {
        return;
    }
    _renderSeen = YES;
    if (_exitAfterRenderMs < 0) {
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, _exitAfterRenderMs * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
                     [NSApp terminate:nil];
                   });
}

- (void)beginSmokeTest {
    if (_smokePath.length == 0) {
        [self finishSmokeTest:NO detail:@"--smoke-test requires a document path"];
        return;
    }
    // The whole check, including a hung web process, must end within 20 s.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 19 * NSEC_PER_SEC), dispatch_get_main_queue(),
                   ^{
                     [self finishSmokeTest:NO detail:@"timed out before the smoke check finished"];
                   });
    NSURL *URL = [NSURL fileURLWithPath:_smokePath];
    [NSDocumentController.sharedDocumentController
        openDocumentWithContentsOfURL:URL
                              display:YES
                    completionHandler:^(NSDocument *document, BOOL wasOpen, NSError *error) {
                      (void)wasOpen;
                      if (error != nil || document == nil) {
                          NSString *detail = error.localizedDescription;
                          [self finishSmokeTest:NO
                                         detail:detail != nil ? detail : @"document did not open"];
                          return;
                      }
                      LDDocumentWindowController *controller =
                          (LDDocumentWindowController *)document.windowControllers.firstObject;
                      if (![controller isKindOfClass:LDDocumentWindowController.class]) {
                          [self finishSmokeTest:NO detail:@"reader window was not created"];
                          return;
                      }
                      [controller runSmokeCheckWithCompletion:^(BOOL success, NSString *detail) {
                        [self finishSmokeTest:success detail:detail];
                      }];
                    }];
}

- (void)finishSmokeTest:(BOOL)success detail:(NSString *)detail {
    FILE *stream = success ? stdout : stderr;
    const char *text = detail.UTF8String;
    std::fprintf(stream, "LeanDoc macOS smoke: %s: %s\n", success ? "PASS" : "FAIL",
                 text != nullptr ? text : "unknown");
    std::fflush(stream);
    std::exit(success ? EXIT_SUCCESS : EXIT_FAILURE);
}

@end
