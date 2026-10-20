#import "LDEditor.h"

#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

namespace {

NSString *const LDWordForTheWeb = @"https://www.office.com/launch/word";

NSString *ApplicationName(NSURL *applicationURL) {
    NSBundle *bundle = [NSBundle bundleWithURL:applicationURL];
    NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"];
    if (name.length == 0) {
        name = [bundle objectForInfoDictionaryKey:@"CFBundleName"];
    }
    if (name.length == 0) {
        name = applicationURL.lastPathComponent.stringByDeletingPathExtension;
    }
    return name;
}

BOOL IsSelf(NSURL *applicationURL) {
    NSBundle *bundle = [NSBundle bundleWithURL:applicationURL];
    NSString *identifier = bundle.bundleIdentifier;
    return identifier != nil &&
           [identifier isEqualToString:NSBundle.mainBundle.bundleIdentifier];
}

}  // namespace

@interface LDEditor ()
@property(nonatomic, readwrite, copy) NSString *kind;
@property(nonatomic, readwrite, copy) NSString *label;
@property(nonatomic, readwrite, nullable) NSURL *applicationURL;
@end

@implementation LDEditor

+ (LDEditor *)shared {
    static LDEditor *editor;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      editor = [[LDEditor alloc] init];
      [editor resolve];
    });
    return editor;
}

- (void)resolve {
    NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
    NSArray<NSArray<NSString *> *> *known = @[
        @[ @"com.microsoft.Word", @"word", @"Open in Word" ],
        @[ @"org.libreoffice.script", @"libreoffice", @"Open in LibreOffice" ],
        @[ @"com.apple.iWork.Pages", @"pages", @"Open in Pages" ],
    ];
    for (NSArray<NSString *> *candidate in known) {
        NSURL *application = [workspace URLForApplicationWithBundleIdentifier:candidate[0]];
        if (application != nil) {
            self.kind = candidate[1];
            self.label = candidate[2];
            self.applicationURL = application;
            return;
        }
    }
    UTType *docx = [UTType typeWithFilenameExtension:@"docx"];
    NSURL *fallback = docx == nil ? nil : [workspace URLForApplicationToOpenContentType:docx];
    if (fallback != nil && !IsSelf(fallback)) {
        NSString *name = ApplicationName(fallback);
        self.kind = @"default";
        self.label = name.length > 0 ? [@"Open in " stringByAppendingString:name]
                                     : @"Open with default app";
        self.applicationURL = fallback;
        return;
    }
    self.kind = @"web";
    self.label = @"Open Word for the web";
    self.applicationURL = nil;
}

- (void)openFileURL:(NSURL *)fileURL
         completion:(void (^)(NSString *_Nullable message, NSString *tone))completion {
    NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
    NSURL *application = self.applicationURL;
    if ([self.kind isEqualToString:@"default"]) {
        // The default can differ by extension, for example .odt.
        NSURL *specific = [workspace URLForApplicationToOpenURL:fileURL];
        if (specific != nil && !IsSelf(specific)) {
            application = specific;
        }
    }
    if (application == nil) {
        NSURL *web = [NSURL URLWithString:LDWordForTheWeb];
        if ([workspace openURL:web]) {
            completion(@"Word for the web opened in your browser. Upload the file there to "
                       @"read or edit it.",
                       @"info");
        } else {
            completion(@"macOS could not open the browser.", @"error");
        }
        return;
    }
    NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
    configuration.activates = YES;
    [workspace openURLs:@[ fileURL ]
        withApplicationAtURL:application
               configuration:configuration
           completionHandler:^(NSRunningApplication *running, NSError *error) {
             (void)running;
             dispatch_async(dispatch_get_main_queue(), ^{
               if (error != nil) {
                   completion(@"LeanDoc could not start the editor.", @"error");
               } else {
                   completion(nil, @"info");
               }
             });
           }];
}

@end
