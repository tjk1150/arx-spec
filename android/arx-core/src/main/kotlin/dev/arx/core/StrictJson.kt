package dev.arx.core

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonUnquotedLiteral

/**
 * RFC 8259 parser with the acceptance rules of JavaScript `JSON.parse` after a
 * `TextDecoder` (leading BOM stripped, later duplicate keys win). kotlinx's own
 * parser also accepts unquoted literals such as `NaN`, which ARX must reject.
 */
internal object StrictJson {
    class ParseException(message: String) : Exception(message)

    /** Deeper nesting is refused instead of risking a stack overflow. */
    private const val MAX_DEPTH = 512

    fun parse(bytes: ByteArray): JsonElement {
        val text = String(bytes, Charsets.UTF_8).removePrefix("﻿")
        return Reader(text).document()
    }

    private class Reader(private val text: String) {
        private var index = 0

        fun document(): JsonElement {
            val value = value(0)
            skipWhitespace()
            if (index != text.length) fail("unexpected character")
            return value
        }

        private fun fail(reason: String): Nothing = throw ParseException("$reason at offset $index")

        private fun skipWhitespace() {
            while (index < text.length && text[index] in " \t\n\r") index++
        }

        private fun value(depth: Int): JsonElement {
            if (depth > MAX_DEPTH) fail("nesting is too deep")
            skipWhitespace()
            if (index >= text.length) fail("unexpected end of input")
            return when (text[index]) {
                '{' -> objectValue(depth)
                '[' -> arrayValue(depth)
                '"' -> JsonPrimitive(string())
                't' -> keyword("true", JsonPrimitive(true))
                'f' -> keyword("false", JsonPrimitive(false))
                'n' -> keyword("null", JsonNull)
                else -> number()
            }
        }

        private fun keyword(word: String, result: JsonElement): JsonElement {
            if (!text.startsWith(word, index)) fail("unexpected token")
            index += word.length
            return result
        }

        private fun objectValue(depth: Int): JsonElement {
            index++
            val members = LinkedHashMap<String, JsonElement>()
            skipWhitespace()
            if (text.getOrNull(index) == '}') {
                index++
                return JsonObject(members)
            }
            while (true) {
                skipWhitespace()
                if (text.getOrNull(index) != '"') fail("expected a string key")
                val key = string()
                skipWhitespace()
                if (text.getOrNull(index) != ':') fail("expected ':'")
                index++
                members[key] = value(depth + 1)
                skipWhitespace()
                when (text.getOrNull(index)) {
                    ',' -> index++
                    '}' -> {
                        index++
                        return JsonObject(members)
                    }
                    else -> fail("expected ',' or '}'")
                }
            }
        }

        private fun arrayValue(depth: Int): JsonElement {
            index++
            val items = ArrayList<JsonElement>()
            skipWhitespace()
            if (text.getOrNull(index) == ']') {
                index++
                return JsonArray(items)
            }
            while (true) {
                items += value(depth + 1)
                skipWhitespace()
                when (text.getOrNull(index)) {
                    ',' -> index++
                    ']' -> {
                        index++
                        return JsonArray(items)
                    }
                    else -> fail("expected ',' or ']'")
                }
            }
        }

        private fun string(): String {
            index++
            val builder = StringBuilder()
            while (true) {
                if (index >= text.length) fail("unterminated string")
                val char = text[index++]
                when {
                    char == '"' -> return builder.toString()
                    char == '\\' -> builder.append(escape())
                    char < ' ' -> fail("control character in string")
                    else -> builder.append(char)
                }
            }
        }

        private fun escape(): Char {
            if (index >= text.length) fail("unterminated escape")
            return when (val char = text[index++]) {
                '"', '\\', '/' -> char
                'b' -> '\b'
                'f' -> '\u000C'
                'n' -> '\n'
                'r' -> '\r'
                't' -> '\t'
                'u' -> {
                    if (index + 4 > text.length) fail("short unicode escape")
                    val digits = text.substring(index, index + 4)
                    if (!digits.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) fail("bad unicode escape")
                    index += 4
                    digits.toInt(16).toChar()
                }
                else -> fail("bad escape")
            }
        }

        @OptIn(ExperimentalSerializationApi::class)
        private fun number(): JsonElement {
            val start = index
            if (text.getOrNull(index) == '-') index++
            when {
                text.getOrNull(index) == '0' -> index++
                text.getOrNull(index)?.let { it in '1'..'9' } == true -> skipDigits()
                else -> fail("unexpected token")
            }
            if (text.getOrNull(index) == '.') {
                index++
                if (!skipDigits()) fail("digit expected after '.'")
            }
            if (text.getOrNull(index) == 'e' || text.getOrNull(index) == 'E') {
                index++
                if (text.getOrNull(index) == '+' || text.getOrNull(index) == '-') index++
                if (!skipDigits()) fail("digit expected in exponent")
            }
            return JsonUnquotedLiteral(text.substring(start, index))
        }

        private fun skipDigits(): Boolean {
            val start = index
            while (index < text.length && text[index] in '0'..'9') index++
            return index > start
        }
    }
}
