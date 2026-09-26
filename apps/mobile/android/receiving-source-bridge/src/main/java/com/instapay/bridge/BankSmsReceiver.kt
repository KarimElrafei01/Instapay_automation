package com.instapay.bridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import java.time.Instant
import java.util.UUID

class BankSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val configuration = BridgeDependencies.configurationStore.current() ?: return
    if (Channel.SMS !in configuration.selectedChannels) return
    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    val sender = messages.firstOrNull()?.originatingAddress ?: return
    if (!sameBank(sender, configuration.bankName)) return
    val text = messages.joinToString(separator = "") { it.messageBody ?: "" }
    BridgeDependencies.eventClient.submit(configuration, Channel.SMS, UUID.randomUUID().toString(), sender, text, Instant.now())
  }
}

internal fun sameBank(actual: String, expected: String): Boolean = actual.trim().lowercase() == expected.trim().lowercase()
