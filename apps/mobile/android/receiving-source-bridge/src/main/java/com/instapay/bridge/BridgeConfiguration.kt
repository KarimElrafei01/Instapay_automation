package com.instapay.bridge

/** Values are written by the authenticated pairing screen to encrypted Android storage. */
data class BridgeConfiguration(
  val apiBaseUrl: String,
  val sourceId: String,
  val deviceCredential: String,
  val signingKey: String,
  val bankName: String,
  val selectedChannels: Set<Channel>,
)

enum class Channel { SMS, NOTIFICATION }

interface BridgeConfigurationStore {
  fun current(): BridgeConfiguration?
}
