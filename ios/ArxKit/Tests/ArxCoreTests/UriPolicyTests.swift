import Foundation
import Testing
@testable import ArxCore

/// Same table as packages/arx-core/test/uri.test.ts (spec 7).
struct UriPolicyTests {
    static let remote = URL(string: "https://cdn.arx.example/e/abc/manifest.json")!

    static func outcome(_ src: String, base: URL = remote, policy: ArxUriPolicy = ArxUriPolicy()) -> String {
        switch ArxUri.resolve(src, manifestURL: base, path: "/layers/0/src", policy: policy) {
        case .success(let url): url.absoluteString
        case .failure(let issue): issue.code.rawValue
        }
    }

    @Test func resolvesRelativePathsAgainstTheManifest() {
        #expect(Self.outcome("assets/video.mp4") == "https://cdn.arx.example/e/abc/assets/video.mp4")
        #expect(Self.outcome("./assets/a.png") == "https://cdn.arx.example/e/abc/assets/a.png")
        #expect(Self.outcome("assets/a.png", base: ArxLocal.manifestURL) == "arx-package://root/assets/a.png")
    }

    @Test func acceptsHttpsIncludingPresignedQueries() {
        let signed = "https://bucket.s3.amazonaws.com/a.mp4?X-Amz-Signature=abc"
        #expect(Self.outcome(signed) == signed)
    }

    @Test(arguments: [
        ("../a.png", "ARX_URI_PATH"),
        ("assets/../../a.png", "ARX_URI_PATH"),
        ("assets/%2e%2e/a.png", "ARX_URI_PATH"),
        ("/assets/a.png", "ARX_URI_PATH"),
        ("assets\\a.png", "ARX_URI_PATH"),
        ("assets/a.png?x=1", "ARX_URI_PATH"),
        ("assets/a.png#frag", "ARX_URI_PATH"),
        ("//evil.example/a.png", "ARX_URI_PATH"),
        ("javascript:alert(1)", "ARX_URI_SCHEME"),
        ("data:image/png;base64,AAAA", "ARX_URI_SCHEME"),
        ("file:///etc/passwd", "ARX_URI_SCHEME"),
        ("http://cdn.arx.example/a.png", "ARX_URI_SCHEME"),
        ("https://user:pass@cdn.arx.example/a.png", "ARX_URI_CREDENTIALS"),
        ("https://localhost/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://127.0.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://10.1.2.3/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://172.20.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://169.254.169.254/latest/meta-data", "ARX_URI_PRIVATE_NETWORK"),
        ("https://[::1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://[fd00::1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://[::ffff:192.168.0.1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
        ("https://[::ffff:c0a8:1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
    ])
    func rejectsUnsafeSources(src: String, code: String) {
        #expect(Self.outcome(src) == code, "\(src)")
    }

    @Test func allowsPublicAddressesThatLookSimilar() {
        #expect(Self.outcome("https://172.32.0.1/a.png") == "https://172.32.0.1/a.png")
        #expect(Self.outcome("https://8.8.8.8/a.png") == "https://8.8.8.8/a.png")
        // 134744072 is 8.8.8.8 written as one decimal number: parsed, and public.
        #expect(Self.outcome("https://134744072/a.png") == "https://134744072/a.png")
    }

    /// The HTTP fetcher refuses URLs the policy rejects before any request is made.
    @Test func httpFetcherRefusesUnsafeURLsWithoutRequesting() async {
        let fetch = ArxHTTP.fetcher()
        for unsafe in ["http://cdn.arx.example/a.png", "https://127.0.0.1/a.png", "file:///etc/passwd"] {
            #expect(await fetch(URL(string: unsafe)!) == nil, "\(unsafe)")
        }
    }

    @Test func allowsHttpLocalhostOnlyInDevelopmentMode() {
        let development = ArxUriPolicy(allowInsecureLocalhost: true, allowPrivateNetwork: true)
        #expect(Self.outcome("http://localhost:3000/a.png", policy: development) == "http://localhost:3000/a.png")
        #expect(Self.outcome("http://example.com/a.png", policy: development) == "ARX_URI_SCHEME")
    }
}
