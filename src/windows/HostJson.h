#pragma once

// A small, strict JSON reader for the messages the reader posts to the host.
// Messages are flat objects; nested objects and arrays are parsed for validity
// and skipped. It has no Windows dependency so tests/hosts can run it on any
// operating system.

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>

namespace leandoc::host_json {

struct Value {
    enum class Kind { Null, Bool, Number, String, Other };
    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0;
    std::string text;  // UTF-8
};

using Object = std::map<std::string, Value, std::less<>>;

class Parser {
public:
    explicit Parser(std::string_view text) : text_(text) {}

    // Parses one JSON value; true when it is a string, with the decoded text.
    bool ParseStringDocument(std::string& output) {
        SkipSpace();
        if (!ParseString(output)) {
            return false;
        }
        SkipSpace();
        return position_ == text_.size();
    }

    // Parses one JSON object and nothing else.
    bool ParseObjectDocument(Object& output) {
        SkipSpace();
        if (!ParseObject(&output, 0)) {
            return false;
        }
        SkipSpace();
        return position_ == text_.size();
    }

private:
    static constexpr int kMaximumDepth = 16;

    void SkipSpace() {
        while (position_ < text_.size() &&
               (text_[position_] == ' ' || text_[position_] == '\t' ||
                text_[position_] == '\n' || text_[position_] == '\r')) {
            ++position_;
        }
    }

    bool Consume(char expected) {
        if (position_ < text_.size() && text_[position_] == expected) {
            ++position_;
            return true;
        }
        return false;
    }

    bool ConsumeWord(std::string_view word) {
        if (text_.substr(position_, word.size()) == word) {
            position_ += word.size();
            return true;
        }
        return false;
    }

    static void AppendUtf8(std::string& output, std::uint32_t code) {
        if (code < 0x80) {
            output.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            output.push_back(static_cast<char>(0xC0 | (code >> 6)));
            output.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else if (code < 0x10000) {
            output.push_back(static_cast<char>(0xE0 | (code >> 12)));
            output.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            output.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            output.push_back(static_cast<char>(0xF0 | (code >> 18)));
            output.push_back(static_cast<char>(0x80 | ((code >> 12) & 0x3F)));
            output.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            output.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }

    bool ParseHex4(std::uint32_t& value) {
        if (position_ + 4 > text_.size()) {
            return false;
        }
        value = 0;
        for (int index = 0; index < 4; ++index) {
            const char digit = text_[position_++];
            value <<= 4;
            if (digit >= '0' && digit <= '9') {
                value |= static_cast<std::uint32_t>(digit - '0');
            } else if (digit >= 'a' && digit <= 'f') {
                value |= static_cast<std::uint32_t>(digit - 'a' + 10);
            } else if (digit >= 'A' && digit <= 'F') {
                value |= static_cast<std::uint32_t>(digit - 'A' + 10);
            } else {
                return false;
            }
        }
        return true;
    }

    bool ParseString(std::string& output) {
        output.clear();
        if (!Consume('"')) {
            return false;
        }
        while (position_ < text_.size()) {
            const auto character = static_cast<unsigned char>(text_[position_++]);
            if (character == '"') {
                return true;
            }
            if (character < 0x20) {
                return false;
            }
            if (character != '\\') {
                output.push_back(static_cast<char>(character));
                continue;
            }
            if (position_ >= text_.size()) {
                return false;
            }
            const char escape = text_[position_++];
            switch (escape) {
                case '"': output.push_back('"'); break;
                case '\\': output.push_back('\\'); break;
                case '/': output.push_back('/'); break;
                case 'b': output.push_back('\b'); break;
                case 'f': output.push_back('\f'); break;
                case 'n': output.push_back('\n'); break;
                case 'r': output.push_back('\r'); break;
                case 't': output.push_back('\t'); break;
                case 'u': {
                    std::uint32_t code = 0;
                    if (!ParseHex4(code)) {
                        return false;
                    }
                    if (code >= 0xD800 && code <= 0xDBFF) {
                        std::uint32_t low = 0;
                        if (!Consume('\\') || !Consume('u') || !ParseHex4(low) ||
                            low < 0xDC00 || low > 0xDFFF) {
                            return false;
                        }
                        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                    } else if (code >= 0xDC00 && code <= 0xDFFF) {
                        return false;
                    }
                    AppendUtf8(output, code);
                    break;
                }
                default:
                    return false;
            }
        }
        return false;
    }

    bool ParseNumber(double& value) {
        const std::size_t start = position_;
        Consume('-');
        if (position_ >= text_.size()) {
            return false;
        }
        if (text_[position_] == '0') {
            ++position_;
        } else if (text_[position_] >= '1' && text_[position_] <= '9') {
            while (position_ < text_.size() && text_[position_] >= '0' && text_[position_] <= '9') {
                ++position_;
            }
        } else {
            return false;
        }
        if (Consume('.')) {
            const std::size_t digits = position_;
            while (position_ < text_.size() && text_[position_] >= '0' && text_[position_] <= '9') {
                ++position_;
            }
            if (digits == position_) {
                return false;
            }
        }
        if (position_ < text_.size() && (text_[position_] == 'e' || text_[position_] == 'E')) {
            ++position_;
            if (!Consume('+')) {
                Consume('-');
            }
            const std::size_t digits = position_;
            while (position_ < text_.size() && text_[position_] >= '0' && text_[position_] <= '9') {
                ++position_;
            }
            if (digits == position_) {
                return false;
            }
        }
        const std::string number(text_.substr(start, position_ - start));
        try {
            value = std::stod(number);
        } catch (...) {
            return false;
        }
        return true;
    }

    bool ParseValue(Value* output, int depth) {
        SkipSpace();
        if (position_ >= text_.size()) {
            return false;
        }
        Value value;
        const char next = text_[position_];
        if (next == '"') {
            value.kind = Value::Kind::String;
            if (!ParseString(value.text)) {
                return false;
            }
        } else if (next == '{') {
            value.kind = Value::Kind::Other;
            if (!ParseObject(nullptr, depth + 1)) {
                return false;
            }
        } else if (next == '[') {
            value.kind = Value::Kind::Other;
            if (!ParseArray(depth + 1)) {
                return false;
            }
        } else if (ConsumeWord("true")) {
            value.kind = Value::Kind::Bool;
            value.boolean = true;
        } else if (ConsumeWord("false")) {
            value.kind = Value::Kind::Bool;
        } else if (ConsumeWord("null")) {
            value.kind = Value::Kind::Null;
        } else {
            value.kind = Value::Kind::Number;
            if (!ParseNumber(value.number)) {
                return false;
            }
        }
        if (output != nullptr) {
            *output = std::move(value);
        }
        return true;
    }

    bool ParseArray(int depth) {
        if (depth > kMaximumDepth || !Consume('[')) {
            return false;
        }
        SkipSpace();
        if (Consume(']')) {
            return true;
        }
        for (;;) {
            if (!ParseValue(nullptr, depth)) {
                return false;
            }
            SkipSpace();
            if (Consume(']')) {
                return true;
            }
            if (!Consume(',')) {
                return false;
            }
        }
    }

    bool ParseObject(Object* output, int depth) {
        if (depth > kMaximumDepth || !Consume('{')) {
            return false;
        }
        SkipSpace();
        if (Consume('}')) {
            return true;
        }
        for (;;) {
            SkipSpace();
            std::string key;
            if (!ParseString(key)) {
                return false;
            }
            SkipSpace();
            if (!Consume(':')) {
                return false;
            }
            Value value;
            if (!ParseValue(&value, depth)) {
                return false;
            }
            if (output != nullptr) {
                (*output)[key] = std::move(value);
            }
            SkipSpace();
            if (Consume('}')) {
                return true;
            }
            if (!Consume(',')) {
                return false;
            }
        }
    }

    std::string_view text_;
    std::size_t position_ = 0;
};

// Accepts either a JSON object or a JSON string that holds one, which is what
// a reader posting JSON.stringify(...) produces through WebView2.
inline std::optional<Object> ParseMessage(std::string_view json) {
    constexpr std::size_t kMaximumBytes = 65536;
    if (json.size() > kMaximumBytes) {
        return std::nullopt;
    }
    std::string inner;
    Object object;
    if (Parser(json).ParseStringDocument(inner)) {
        if (Parser(inner).ParseObjectDocument(object)) {
            return object;
        }
        return std::nullopt;
    }
    if (Parser(json).ParseObjectDocument(object)) {
        return object;
    }
    return std::nullopt;
}

inline std::optional<std::string> GetString(const Object& object, std::string_view key) {
    const auto found = object.find(key);
    if (found == object.end() || found->second.kind != Value::Kind::String) {
        return std::nullopt;
    }
    return found->second.text;
}

inline std::optional<unsigned> GetUnsigned(const Object& object, std::string_view key) {
    const auto found = object.find(key);
    if (found == object.end() || found->second.kind != Value::Kind::Number) {
        return std::nullopt;
    }
    const double number = found->second.number;
    if (number < 0 || number > 4294967295.0 ||
        number != static_cast<double>(static_cast<std::uint32_t>(number))) {
        return std::nullopt;
    }
    return static_cast<unsigned>(number);
}

}  // namespace leandoc::host_json
