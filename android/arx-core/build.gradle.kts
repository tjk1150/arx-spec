plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.json.schema.validator)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test"))
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // Conformance fixtures and the schema live at the repository root; declare them as
    // inputs so a fixture change reruns the tests instead of reusing the cached result.
    systemProperty("arx.repoRoot", rootDir.parentFile.absolutePath)
    inputs.dir(rootDir.parentFile.resolve("fixtures")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(rootDir.parentFile.resolve("schema")).withPathSensitivity(PathSensitivity.RELATIVE)
}
