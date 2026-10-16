import Foundation
import JSONSchema

/// Structural validation against the normative JSON Schema (bundled copy of
/// schema/arx-0.1.schema.json; a test keeps the two identical).
enum ArxSchema {
    static func bundledSchemaData() throws -> Data {
        guard let url = Bundle.module.url(forResource: "arx-0.1.schema", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try Data(contentsOf: url)
    }

    static let schema: Schema? = {
        guard let data = try? bundledSchemaData() else { return nil }
        return try? Schema(instance: String(decoding: data, as: UTF8.self), formatValidators: [UriReferenceFormat()])
    }()

    /// ARX_SCHEMA issues at each failing instance location, deduplicated.
    static func check(_ json: String) -> [ArxIssue] {
        guard let schema else {
            return [.error(.schema, "/", "the bundled ARX schema could not be loaded")]
        }
        let result: ValidationResult
        do {
            result = try schema.validate(instance: json)
        } catch {
            return [.error(.jsonParse, "", String(describing: error))]
        }
        guard !result.isValid else { return [] }
        var seen = Set<String>()
        var issues: [ArxIssue] = []
        func collect(_ errors: [ValidationError]) {
            for detail in errors {
                let pointer = detail.instanceLocation.jsonPointerString
                let path = pointer.isEmpty ? "/" : pointer
                let message = "\(detail.message) (\(detail.keywordLocation.jsonPointerString))"
                if seen.insert("\(path) \(message)").inserted {
                    issues.append(.error(.schema, path, message))
                }
                collect(detail.errors ?? [])
            }
        }
        collect(result.errors ?? [])
        if issues.isEmpty { issues.append(.error(.schema, "/", "manifest does not match the ARX 0.1 schema")) }
        return issues
    }

    /// RFC 3986 URI-reference, the same expression ajv-formats uses in the
    /// TypeScript validator, so both reject the same strings (fixture N016).
    struct UriReferenceFormat: FormatValidator {
        let formatName = "uri-reference"

        private static let expression: NSRegularExpression? = try? NSRegularExpression(
            pattern: #"^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$"#,
            options: [.caseInsensitive])

        func validate(_ value: String) -> Bool {
            guard let expression = Self.expression else { return false }
            let range = NSRange(value.startIndex..., in: value)
            return expression.firstMatch(in: value, options: [.anchored], range: range)?.range == range
        }
    }
}
