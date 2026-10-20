#import "LDDocument.h"

#import "LDAppDelegate.h"
#import "LDDocumentWindowController.h"
#import "LDTiming.h"

#include "core/DocCore.h"

#include <chrono>
#include <filesystem>
#include <string>

NSString *const LDDocumentTypeName = @"LeanDoc Document";

namespace {

NSString *const LDDocumentErrorDomain = @"io.github.abooodbah.LeanDoc.document";
NSString *const LDRecentKey = @"LeanDocRecent";
constexpr NSUInteger kMaximumRecent = 10;

NSError *DocumentError(NSInteger code, NSString *description) {
    return [NSError errorWithDomain:LDDocumentErrorDomain
                               code:code
                           userInfo:@{NSLocalizedDescriptionKey : description}];
}

NSUInteger NextTabId(void) {
    static NSUInteger next = 0;
    return ++next;
}

void AddRecent(NSString *path) {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    NSMutableArray<NSString *> *recent = [NSMutableArray array];
    for (id item in [defaults arrayForKey:LDRecentKey] ?: @[]) {
        if ([item isKindOfClass:NSString.class] && ![item isEqualToString:path]) {
            [recent addObject:item];
        }
    }
    [recent insertObject:path atIndex:0];
    while (recent.count > kMaximumRecent) {
        [recent removeLastObject];
    }
    [defaults setObject:recent forKey:LDRecentKey];
}

}  // namespace

@interface LDDocument () {
    NSURL *_sourceURL;
    NSData *_package;
    NSDictionary<NSString *, id> *_report;
    NSUInteger _tabId;
    NSUInteger _generation;
    NSTimer *_pollTimer;
    NSDate *_loadedDate;
    NSNumber *_loadedSize;
    NSDate *_pendingDate;
    NSNumber *_pendingSize;
    NSTimeInterval _pendingSince;
    BOOL _missingReported;
    NSUInteger _lastCoreMilliseconds;
}
@end

@implementation LDDocument

+ (BOOL)autosavesInPlace {
    return NO;
}

+ (NSArray<NSString *> *)readableTypes {
    return @[ LDDocumentTypeName ];
}

+ (NSArray<NSString *> *)writableTypes {
    return @[];
}

+ (BOOL)canConcurrentlyReadDocumentsOfType:(NSString *)typeName {
    (void)typeName;
    return NO;
}

- (instancetype)init {
    self = [super init];
    if (self != nil) {
        _tabId = NextTabId();
    }
    return self;
}

+ (NSArray<NSString *> *)recentPaths {
    NSMutableArray<NSString *> *recent = [NSMutableArray array];
    for (id item in [NSUserDefaults.standardUserDefaults arrayForKey:LDRecentKey] ?: @[]) {
        if ([item isKindOfClass:NSString.class] && recent.count < kMaximumRecent) {
            [recent addObject:item];
        }
    }
    return recent;
}

+ (void)clearRecent {
    [NSUserDefaults.standardUserDefaults removeObjectForKey:LDRecentKey];
}

- (NSUInteger)lastCoreMilliseconds {
    return _lastCoreMilliseconds;
}

- (BOOL)hasSourceFile {
    return _sourceURL != nil;
}

- (NSUInteger)tabId {
    return _tabId;
}

- (NSUInteger)generation {
    return _generation;
}

- (void)makeWindowControllers {
    LDDocumentWindowController *controller =
        [[LDDocumentWindowController alloc] initWithDocument:self];
    [self addWindowController:controller];
    [self startWatching];
}

- (BOOL)readFromURL:(NSURL *)URL ofType:(NSString *)typeName error:(NSError **)outError {
    (void)typeName;
    if (!URL.isFileURL ||
        !leandoc::core::IsSupportedDocumentPath(std::filesystem::path(URL.fileSystemRepresentation))) {
        if (outError != nullptr) {
            *outError = DocumentError(
                NSFileReadUnsupportedSchemeError,
                @"LeanDoc opens .docx, .dotx, .docm, .dotm, .doc, .rtf, and .odt files.");
        }
        return NO;
    }
    _sourceURL = URL.URLByStandardizingPath.URLByResolvingSymlinksInPath;
    [self loadFromDisk];
    LDAppDelegate *delegate = (LDAppDelegate *)NSApp.delegate;
    if (![delegate isKindOfClass:LDAppDelegate.class] || !delegate.smokeTesting) {
        AddRecent(_sourceURL.path);
    }
    return YES;
}

- (void)loadFromDisk {
    // The stamp is taken before the read, so an edit that lands mid-read
    // shows up as a newer stamp on the next poll.
    NSDate *date = nil;
    NSNumber *size = nil;
    if ([self captureStampDate:&date size:&size]) {
        _loadedDate = date;
        _loadedSize = size;
    }
    if (LDTimingEnabled()) {
        LDTraceTiming(@"document-requested",
                      [NSString stringWithFormat:@"tab=%lu generation=%lu",
                                                 static_cast<unsigned long>(_tabId),
                                                 static_cast<unsigned long>(_generation + 1)]);
    }
    const auto coreStart = std::chrono::steady_clock::now();
    leandoc::core::OpenResult result =
        leandoc::core::OpenDocumentFile(std::filesystem::path(_sourceURL.fileSystemRepresentation));
    _lastCoreMilliseconds = static_cast<NSUInteger>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - coreStart)
            .count());
    const std::string json = leandoc::core::ReportToJson(result);
    NSData *jsonData = [NSData dataWithBytes:json.data() length:json.size()];
    id report = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil];
    _report = [report isKindOfClass:NSDictionary.class] ? report : @{};
    const bool renderable = result.ok && leandoc::core::IsRenderableKind(result.kind) &&
                            !result.sanitizedPackage.empty();
    _package = renderable ? [NSData dataWithBytes:result.sanitizedPackage.data()
                                           length:result.sanitizedPackage.size()]
                          : nil;
    ++_generation;
    _pendingDate = nil;
    _pendingSize = nil;
    _missingReported = NO;
}

- (NSData *)dataOfType:(NSString *)typeName error:(NSError **)outError {
    (void)typeName;
    if (outError != nullptr) {
        *outError = DocumentError(NSFeatureUnsupportedError,
                                  @"LeanDoc is a read-only viewer and does not save documents.");
    }
    return nil;
}

- (BOOL)isDocumentEdited {
    return NO;
}

- (NSDictionary<NSString *, id> *)readerPayload {
    if (_sourceURL == nil) {
        NSMutableArray *recent = [NSMutableArray array];
        for (NSString *item in [LDDocument recentPaths]) {
            [recent addObject:@{ @"path" : item, @"name" : item.lastPathComponent }];
        }
        return @{ @"type" : @"empty", @"recent" : recent };
    }
    NSString *fileName = _sourceURL.lastPathComponent ?: @"";
    NSString *path = _sourceURL.path ?: @"";
    NSMutableDictionary<NSString *, id> *payload = [@{
        @"type" : _package != nil ? @"document" : @"fallback",
        @"tab" : @(_tabId),
        @"generation" : @(_generation),
        @"fileName" : fileName,
        @"displayPath" : path,
        @"report" : _report ?: @{},
    } mutableCopy];
    if (_package != nil) {
        payload[@"packageUrl"] = [NSString stringWithFormat:@"leandoc://app/pkg/%lu/%lu/document.docx",
                                  static_cast<unsigned long>(_tabId),
                                  static_cast<unsigned long>(_generation)];
    }
    return payload;
}

- (NSData *)packageForTab:(NSUInteger)tab generation:(NSUInteger)generation {
    if (_package == nil || tab != _tabId || generation != _generation) {
        return nil;
    }
    return _package;
}

- (void)reloadFromDisk {
    if (_sourceURL == nil) {
        return;
    }
    [self loadFromDisk];
    for (NSWindowController *controller in self.windowControllers) {
        if ([controller isKindOfClass:LDDocumentWindowController.class]) {
            [(LDDocumentWindowController *)controller documentContentDidChange];
        }
    }
}

- (void)startWatching {
    if (_sourceURL == nil || _pollTimer != nil) {
        return;
    }
    LDAppDelegate *delegate = (LDAppDelegate *)NSApp.delegate;
    if ([delegate isKindOfClass:LDAppDelegate.class] && delegate.smokeTesting) {
        return;
    }
    __weak LDDocument *weakSelf = self;
    _pollTimer = [NSTimer timerWithTimeInterval:0.5
                                        repeats:YES
                                          block:^(NSTimer *timer) {
                                            (void)timer;
                                            [weakSelf poll];
                                          }];
    [NSRunLoop.mainRunLoop addTimer:_pollTimer forMode:NSRunLoopCommonModes];
}

- (void)close {
    [_pollTimer invalidate];
    _pollTimer = nil;
    [super close];
}

- (BOOL)captureStampDate:(NSDate *__strong *)date size:(NSNumber *__strong *)size {
    if (_sourceURL == nil) {
        return NO;
    }
    NSDictionary<NSURLResourceKey, id> *values =
        [_sourceURL resourceValuesForKeys:@[ NSURLContentModificationDateKey, NSURLFileSizeKey,
                                              NSURLIsRegularFileKey ]
                                    error:nil];
    if (![values[NSURLIsRegularFileKey] boolValue] ||
        values[NSURLContentModificationDateKey] == nil || values[NSURLFileSizeKey] == nil) {
        return NO;
    }
    *date = values[NSURLContentModificationDateKey];
    *size = values[NSURLFileSizeKey];
    return YES;
}

- (void)poll {
    NSDate *date = nil;
    NSNumber *size = nil;
    if (![self captureStampDate:&date size:&size]) {
        if (!_missingReported) {
            _missingReported = YES;
            [self broadcastStatus:@"The file was moved or deleted. The last complete view is still shown."
                             tone:@"warning"];
        }
        return;
    }
    _missingReported = NO;
    if ([_loadedDate isEqualToDate:date] && [_loadedSize isEqual:size]) {
        _pendingDate = nil;
        _pendingSize = nil;
        return;
    }
    if (!([_pendingDate isEqualToDate:date] && [_pendingSize isEqual:size])) {
        _pendingDate = date;
        _pendingSize = size;
        _pendingSince = NSProcessInfo.processInfo.systemUptime;
        return;
    }
    if (NSProcessInfo.processInfo.systemUptime - _pendingSince >= 0.35) {
        [self reloadFromDisk];
    }
}

- (void)broadcastStatus:(NSString *)message tone:(NSString *)tone {
    for (NSWindowController *controller in self.windowControllers) {
        if ([controller isKindOfClass:LDDocumentWindowController.class]) {
            [(LDDocumentWindowController *)controller showStatus:message tone:tone];
        }
    }
}

@end
