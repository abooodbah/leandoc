// TEMPORARY stub of the LeanDoc core for host development. It classifies by
// magic bytes, reads the file, and hands the original bytes back as the
// "sanitized" package. Stream A replaces it with the real core.

#include "core/DocCore.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <fstream>
#include <system_error>

namespace leandoc::core {
namespace {

bool StartsWith(std::string_view bytes, std::string_view prefix) {
    return bytes.size() >= prefix.size() &&
           bytes.substr(0, prefix.size()) == prefix;
}

}  // namespace

bool IsRenderableKind(FileKind kind) {
    return kind == FileKind::Docx || kind == FileKind::Dotx ||
           kind == FileKind::Docm || kind == FileKind::Dotm;
}

const char* FileKindName(FileKind kind) {
    switch (kind) {
        case FileKind::Docx: return "docx";
        case FileKind::Dotx: return "dotx";
        case FileKind::Docm: return "docm";
        case FileKind::Dotm: return "dotm";
        case FileKind::LegacyDoc: return "legacy-doc";
        case FileKind::EncryptedOoxml: return "encrypted-ooxml";
        case FileKind::Rtf: return "rtf";
        case FileKind::Odt: return "odt";
        default: return "not-a-document";
    }
}

const char* FeatureCode(Feature feature) {
    switch (feature) {
        case Feature::TextBox: return "text-box";
        case Feature::Equation: return "equation";
        case Feature::Chart: return "chart";
        case Feature::SmartArt: return "smart-art";
        case Feature::Shape: return "shape";
        case Feature::OleObject: return "ole-object";
        case Feature::ActiveX: return "activex";
        case Feature::AltChunk: return "alt-chunk";
        case Feature::TrackedChanges: return "tracked-changes";
        case Feature::Comments: return "comments";
        case Feature::Macros: return "macros";
        case Feature::RemoteTemplate: return "remote-template";
        case Feature::RemoteImage: return "remote-image";
        case Feature::ExternalContent: return "external-content";
        case Feature::DdeField: return "dde-field";
        default: return "embedded-fonts";
    }
}

bool FeatureIsNotDisplayed(Feature feature) {
    return static_cast<int>(feature) <= static_cast<int>(Feature::AltChunk);
}

FeatureLabel LabelFor(Feature feature) {
    (void)feature;
    return {"item", "items"};
}

FileKind DetectKind(std::string_view bytes) {
    if (StartsWith(bytes, std::string_view("PK\x03\x04", 4))) {
        if (bytes.find("application/vnd.oasis.opendocument.text") !=
            std::string_view::npos) {
            return FileKind::Odt;
        }
        if (bytes.find("word/document.xml") != std::string_view::npos) {
            return FileKind::Docx;
        }
        return FileKind::NotADocument;
    }
    if (StartsWith(bytes, std::string_view("\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", 8))) {
        return FileKind::LegacyDoc;
    }
    if (StartsWith(bytes, "{\\rtf")) {
        return FileKind::Rtf;
    }
    return FileKind::NotADocument;
}

OpenResult OpenDocumentBytes(std::string_view bytes, const Limits& limits) {
    OpenResult result;
    result.sourceBytes = bytes.size();
    if (bytes.size() > limits.maximumInputBytes) {
        result.errorCode = "too-large";
        result.errorMessage = "This file is larger than LeanDoc's safety limit.";
        return result;
    }
    result.kind = DetectKind(bytes);
    result.ok = true;
    if (IsRenderableKind(result.kind)) {
        result.sanitizedPackage.assign(bytes.data(), bytes.size());
    }
    return result;
}

OpenResult OpenDocumentFile(const std::filesystem::path& path, const Limits& limits) {
    OpenResult result;
    std::error_code error;
    if (!std::filesystem::is_regular_file(path, error)) {
        result.errorCode = "read-failed";
        result.errorMessage = "LeanDoc could not read this file.";
        return result;
    }
    const auto size = std::filesystem::file_size(path, error);
    if (error) {
        result.errorCode = "read-failed";
        result.errorMessage = "LeanDoc could not read this file.";
        return result;
    }
    if (size > limits.maximumInputBytes) {
        result.errorCode = "too-large";
        result.errorMessage = "This file is larger than LeanDoc's safety limit.";
        result.sourceBytes = size;
        return result;
    }
    std::ifstream stream(path, std::ios::binary);
    std::string bytes(static_cast<std::size_t>(size), '\0');
    if (!stream.read(bytes.data(), static_cast<std::streamsize>(bytes.size()))) {
        result.errorCode = "read-failed";
        result.errorMessage = "LeanDoc could not read this file.";
        return result;
    }
    return OpenDocumentBytes(bytes, limits);
}

bool IsSupportedDocumentPath(const std::filesystem::path& path) {
    std::string extension = path.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(),
                   [](unsigned char value) { return static_cast<char>(std::tolower(value)); });
    return extension == ".docx" || extension == ".dotx" || extension == ".docm" ||
           extension == ".dotm" || extension == ".doc" || extension == ".rtf" ||
           extension == ".odt";
}

std::string ReportToJson(const OpenResult& result) {
    std::string json = "{\"ok\":";
    json += result.ok ? "true" : "false";
    json += ",\"errorCode\":\"";
    AppendJsonString(json, result.errorCode);
    json += "\",\"errorMessage\":\"";
    AppendJsonString(json, result.errorMessage);
    json += "\",\"kind\":\"";
    json += FileKindName(result.kind);
    json += "\",\"sourceBytes\":";
    json += std::to_string(result.sourceBytes);
    json += ",\"features\":[";
    for (std::size_t index = 0; index < result.features.size(); ++index) {
        const FeatureCount& count = result.features[index];
        const FeatureLabel label = LabelFor(count.feature);
        json += index == 0 ? "{" : ",{";
        json += "\"code\":\"";
        json += FeatureCode(count.feature);
        json += "\",\"count\":" + std::to_string(count.count);
        json += ",\"notDisplayed\":";
        json += FeatureIsNotDisplayed(count.feature) ? "true" : "false";
        json += ",\"singular\":\"";
        json += label.singular;
        json += "\",\"plural\":\"";
        json += label.plural;
        json += "\"}";
    }
    json += "],\"outline\":[";
    for (std::size_t index = 0; index < result.outline.size(); ++index) {
        const OutlineEntry& entry = result.outline[index];
        json += index == 0 ? "{" : ",{";
        json += "\"level\":" + std::to_string(entry.level);
        json += ",\"text\":\"";
        AppendJsonString(json, entry.text);
        json += "\",\"paragraph\":" + std::to_string(entry.paragraphIndex) + "}";
    }
    json += "],\"properties\":{\"title\":\"";
    AppendJsonString(json, result.properties.title);
    json += "\",\"creator\":\"";
    AppendJsonString(json, result.properties.creator);
    json += "\",\"rightToLeft\":";
    json += result.properties.rightToLeft ? "true" : "false";
    json += "}}";
    return json;
}

bool IsPathWithin(const std::filesystem::path& root, const std::filesystem::path& candidate) {
    std::error_code error;
    const auto base = std::filesystem::weakly_canonical(root, error);
    if (error) {
        return false;
    }
    const auto target = std::filesystem::weakly_canonical(candidate, error);
    if (error) {
        return false;
    }
    auto baseIterator = base.begin();
    auto targetIterator = target.begin();
    for (; baseIterator != base.end(); ++baseIterator, ++targetIterator) {
        if (baseIterator->empty() && std::next(baseIterator) == base.end()) {
            break;
        }
        if (targetIterator == target.end() || *baseIterator != *targetIterator) {
            return false;
        }
    }
    return true;
}

void AppendJsonString(std::string& output, std::string_view value) {
    static constexpr char kHex[] = "0123456789abcdef";
    for (const char character : value) {
        const auto byte = static_cast<unsigned char>(character);
        switch (character) {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if (byte < 0x20) {
                    output += "\\u00";
                    output += kHex[byte >> 4];
                    output += kHex[byte & 0x0F];
                } else {
                    output += character;
                }
        }
    }
}

std::string EscapeJsonString(std::string_view value) {
    std::string output;
    AppendJsonString(output, value);
    return output;
}

}  // namespace leandoc::core
