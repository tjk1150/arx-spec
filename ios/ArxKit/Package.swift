// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ArxKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "ArxCore", targets: ["ArxCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ajevans99/swift-json-schema", exact: "0.14.1"),
        .package(url: "https://github.com/weichsel/ZIPFoundation", exact: "0.9.20"),
    ],
    targets: [
        .target(
            name: "ArxCore",
            dependencies: [
                .product(name: "JSONSchema", package: "swift-json-schema"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation"),
            ],
            resources: [
                .copy("Resources/arx-0.1.schema.json"),
                .copy("Resources/ARX_effects.schema.json"),
                .copy("Resources/ARX_effects.presets.json"),
            ]
        ),
        .testTarget(name: "ArxCoreTests", dependencies: ["ArxCore"]),
    ]
)
