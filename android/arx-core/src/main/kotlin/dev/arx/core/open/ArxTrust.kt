package dev.arx.core.open

import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * TLS trust for development servers: the system roots plus extra roots given as
 * DER or PEM bytes. Hostname verification stays with HttpsURLConnection.
 */
internal object ArxTrust {
    fun socketFactory(roots: List<ByteArray>): SSLSocketFactory {
        val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
        roots.flatMap(::certificates).forEachIndexed { index, certificate ->
            store.setCertificateEntry("arx-root-$index", certificate)
        }
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf(EitherTrustManager(trustManager(null), trustManager(store))), null)
        return context.socketFactory
    }

    /** Every X.509 certificate in [bytes] (DER, or one or more PEM blocks). */
    fun certificates(bytes: ByteArray): List<X509Certificate> {
        val parsed = try {
            CertificateFactory.getInstance("X.509").generateCertificates(ByteArrayInputStream(bytes))
        } catch (failure: CertificateException) {
            throw IllegalArgumentException("not a DER or PEM certificate", failure)
        }
        val certificates = parsed.filterIsInstance<X509Certificate>()
        require(certificates.isNotEmpty()) { "no X.509 certificate found" }
        return certificates
    }

    /** The platform's default trust manager for [store], or for the system roots when it is null. */
    private fun trustManager(store: KeyStore?): X509TrustManager {
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(store)
        return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    /** Accepts a server chain that leads to a root of either [system] or [extra]. */
    private class EitherTrustManager(
        private val system: X509TrustManager,
        private val extra: X509TrustManager,
    ) : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) {
            system.checkClientTrusted(chain, authType)
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
            try {
                system.checkServerTrusted(chain, authType)
            } catch (systemFailure: CertificateException) {
                try {
                    extra.checkServerTrusted(chain, authType)
                } catch (extraFailure: CertificateException) {
                    extraFailure.addSuppressed(systemFailure)
                    throw extraFailure
                }
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers + extra.acceptedIssuers
    }
}
