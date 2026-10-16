package dev.arx.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FixtureAccessTest {
    @Test
    fun seesTheRepositoryFixtures() {
        val root = File(System.getProperty("arx.repoRoot"))
        assertTrue(File(root, "fixtures/positive/C001-minimal-image/manifest.json").isFile)
        assertTrue(File(root, "schema/arx-0.1.schema.json").isFile)
    }

    @Test
    fun positiveFixturesDeclareTheSupportedSpec() {
        val names = Fixtures.names("positive").filter { Fixtures.file("positive/$it/manifest.json").isFile }
        assertTrue(names.size >= 15, "$names")
        for (name in names) {
            // C018 starts with a UTF-8 byte order mark, which ARX accepts and kotlinx.serialization does not.
            val text = Fixtures.file("positive/$name/manifest.json").readText().removePrefix("\uFEFF")
            val json = Json.parseToJsonElement(text)
            assertEquals(ArxSpec.VERSION, json.jsonObject["spec"]?.jsonPrimitive?.content, name)
        }
    }
}
