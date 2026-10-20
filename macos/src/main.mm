#import "LDAppDelegate.h"
#import "LDDocumentController.h"
#import "LDTiming.h"

#import <AppKit/AppKit.h>

int main(int argc, const char *argv[]) {
    (void)argc;
    (void)argv;
    @autoreleasepool {
        for (NSString *argument in NSProcessInfo.processInfo.arguments) {
            if ([argument isEqualToString:@"--trace-timing"]) {
                LDEnableTiming();
                LDTraceTiming(@"process-start", nil);
                break;
            }
        }
        NSApplication *application = NSApplication.sharedApplication;
        // The first document controller created becomes the shared one.
        (void)[[LDDocumentController alloc] init];
        LDAppDelegate *delegate = [[LDAppDelegate alloc] init];
        application.delegate = delegate;
        [delegate installMainMenu];
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
