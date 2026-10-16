package dev.arx.core.open

import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import dev.arx.core.ArxUriPolicy
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * trustedRootCertificates against a local HTTPS server whose certificate is
 * signed by a throwaway root made with the JDK's keytool, like a development
 * server with a private CA.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ArxHttpsTrustTest {
    private val password = "arx-test"
    private val body = "served over https".toByteArray()
    private val development = ArxUriPolicy(allowPrivateNetwork = true)
    private lateinit var directory: File
    private lateinit var server: HttpsServer

    private val url: String get() = "https://127.0.0.1:${server.address.port}/asset"

    @BeforeAll
    fun start() {
        val keytool = File(System.getProperty("java.home"), "bin/keytool")
        assumeTrue(keytool.canExecute(), "keytool is not available")
        directory = Files.createTempDirectory("arx-tls").toFile()
        makeCertificates(keytool.path)

        val store = KeyStore.getInstance("PKCS12")
        File(directory, "server.p12").inputStream().use { store.load(it, password.toCharArray()) }
        val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        keys.init(store, password.toCharArray())
        val context = SSLContext.getInstance("TLS").apply { init(keys.keyManagers, null, null) }

        server = HttpsServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.httpsConfigurator = HttpsConfigurator(context)
        server.createContext("/asset") { exchange ->
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
    }

    @AfterAll
    fun stop() {
        if (::server.isInitialized) server.stop(0)
        if (::directory.isInitialized) directory.deleteRecursively()
    }

    private fun get(transport: ArxHttpTransport): ByteArray = transport.get(url, 1L shl 20, ArxCancellation()) { _, _ -> }.bytes

    @Test
    fun trustsAServerSignedByAGivenPemRoot() {
        val root = File(directory, "root.pem").readBytes()
        assertContentEquals(body, get(ArxHttpTransport(development, trustedRootCertificates = listOf(root))))
    }

    @Test
    fun trustsAServerSignedByAGivenDerRoot() {
        val root = File(directory, "root.der").readBytes()
        assertContentEquals(body, get(ArxHttpTransport(development, trustedRootCertificates = listOf(root))))
    }

    @Test
    fun refusesTheServerWithoutTheRoot() {
        val failure = assertFailsWith<ArxOpenFailure> { get(ArxHttpTransport(development)) }
        assertEquals(ArxViewerCode.DOWNLOAD_FAILED, failure.viewerCode)
    }

    @Test
    fun refusesTheServerWhenAnotherRootIsGiven() {
        val other = File(directory, "other.pem").readBytes()
        val failure = assertFailsWith<ArxOpenFailure> {
            get(ArxHttpTransport(development, trustedRootCertificates = listOf(other)))
        }
        assertEquals(ArxViewerCode.DOWNLOAD_FAILED, failure.viewerCode)
    }

    @Test
    fun rejectsBytesThatAreNotACertificate() {
        assertFailsWith<IllegalArgumentException> {
            ArxHttpTransport(development, trustedRootCertificates = listOf("not a certificate".toByteArray()))
        }
    }

    /** root.p12 signs server.p12 for IP 127.0.0.1; other.p12 is an unrelated root. */
    private fun makeCertificates(keytool: String) {
        fun run(vararg arguments: String) {
            val process = ProcessBuilder(keytool, *arguments)
                .directory(directory)
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().readText()
            check(process.waitFor(60, TimeUnit.SECONDS) && process.exitValue() == 0) { "keytool failed: $output" }
        }
        val common = arrayOf("-storetype", "PKCS12", "-storepass", password, "-keyalg", "EC", "-groupname", "secp256r1")
        run("-genkeypair", "-keystore", "root.p12", "-alias", "root", *common, "-dname", "CN=ARX Test Root", "-ext", "bc:c", "-validity", "2")
        run("-genkeypair", "-keystore", "other.p12", "-alias", "other", *common, "-dname", "CN=ARX Other Root", "-ext", "bc:c", "-validity", "2")
        run("-genkeypair", "-keystore", "server.p12", "-alias", "server", *common, "-dname", "CN=127.0.0.1", "-validity", "2")
        run("-certreq", "-keystore", "server.p12", "-storepass", password, "-alias", "server", "-file", "server.csr")
        run(
            "-gencert", "-keystore", "root.p12", "-storepass", password, "-alias", "root", "-infile", "server.csr",
            "-outfile", "server.pem", "-rfc", "-ext", "san=ip:127.0.0.1", "-validity", "2",
        )
        run("-exportcert", "-keystore", "root.p12", "-storepass", password, "-alias", "root", "-rfc", "-file", "root.pem")
        run("-exportcert", "-keystore", "root.p12", "-storepass", password, "-alias", "root", "-file", "root.der")
        run("-exportcert", "-keystore", "other.p12", "-storepass", password, "-alias", "other", "-rfc", "-file", "other.pem")
        run("-importcert", "-keystore", "server.p12", "-storepass", password, "-alias", "root", "-file", "root.pem", "-noprompt")
        run("-importcert", "-keystore", "server.p12", "-storepass", password, "-alias", "server", "-file", "server.pem")
    }
}
