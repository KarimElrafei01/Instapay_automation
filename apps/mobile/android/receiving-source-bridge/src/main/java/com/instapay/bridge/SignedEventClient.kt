package com.instapay.bridge

import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.concurrent.Executors
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

interface SignedEventClient {
  fun submit(configuration: BridgeConfiguration, channel: Channel, eventId: String, senderIdentity: String, rawText: String, receivedAt: Instant)
}

class HttpSignedEventClient : SignedEventClient {
  private val executor = Executors.newSingleThreadExecutor()

  override fun submit(configuration: BridgeConfiguration, channel: Channel, eventId: String, senderIdentity: String, rawText: String, receivedAt: Instant) {
    executor.execute {
      val event = JSONObject().apply {
        put("eventId", eventId)
        put("channel", if (channel == Channel.SMS) "sms" else "notification")
        put("senderIdentity", senderIdentity)
        put("rawText", rawText)
        put("receivedAt", receivedAt.toString())
      }
      val payload = Base64.encodeToString(event.toString().toByteArray(StandardCharsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
      val signature = hmacSha256(configuration.signingKey, payload)
      val connection = (URL("${configuration.apiBaseUrl.trimEnd('/')}/v1/device/receiving-sources/${configuration.sourceId}/test-alert").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        doOutput = true
        connectTimeout = 10_000
        readTimeout = 10_000
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer ${configuration.deviceCredential}")
        setRequestProperty("X-Device-Signature", signature)
      }
      connection.outputStream.use { it.write("{\"payload\":\"$payload\"}".toByteArray(StandardCharsets.UTF_8)) }
      connection.responseCode // Never log raw message content or credentials.
      connection.disconnect()
    }
  }

  private fun hmacSha256(key: String, message: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
    return Base64.encodeToString(mac.doFinal(message.toByteArray(StandardCharsets.UTF_8)), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  }
}

object BridgeDependencies {
  lateinit var configurationStore: BridgeConfigurationStore
  lateinit var eventClient: SignedEventClient
}
