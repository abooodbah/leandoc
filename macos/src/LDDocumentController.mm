#import "LDDocumentController.h"

#import "LDDocument.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

namespace {

NSArray<NSString *> *SupportedExtensions(void) {
    return @[ @"docx", @"dotx", @"docm", @"dotm", @"doc", @"rtf", @"odt" ];
}

}  // namespace

@implementation LDDocumentController

+ (BOOL)isSupportedURL:(NSURL *)URL {
    return URL.isFileURL &&
           [SupportedExtensions() containsObject:URL.pathExtension.lowercaseString];
}

- (NSString *)typeForContentsOfURL:(NSURL *)URL error:(NSError **)outError {
    if ([LDDocumentController isSupportedURL:URL]) {
        return LDDocumentTypeName;
    }
    return [super typeForContentsOfURL:URL error:outError];
}

- (Class)documentClassForType:(NSString *)typeName {
    (void)typeName;
    return LDDocument.class;
}

- (NSArray<NSString *> *)documentClassNames {
    return @[ @"LDDocument" ];
}

- (NSString *)defaultType {
    return LDDocumentTypeName;
}

- (void)openDocument:(id)sender {
    (void)sender;
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = @"Open documents";
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = YES;
    NSMutableArray<UTType *> *types = [NSMutableArray array];
    for (NSString *extension in SupportedExtensions()) {
        UTType *type = [UTType typeWithFilenameExtension:extension];
        if (type != nil) {
            [types addObject:type];
        }
    }
    panel.allowedContentTypes = types;
    [panel beginWithCompletionHandler:^(NSModalResponse response) {
      if (response != NSModalResponseOK) {
          return;
      }
      for (NSURL *URL in panel.URLs) {
          [self openDocumentWithContentsOfURL:URL
                                      display:YES
                            completionHandler:^(NSDocument *document, BOOL wasOpen, NSError *error) {
                              (void)document;
                              (void)wasOpen;
                              if (error != nil) {
                                  [NSApp presentError:error];
                              }
                            }];
      }
    }];
}

@end
