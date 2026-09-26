package com.instapay.bridge

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.time.Instant
import java.util.UUID

class BankNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(notification: StatusBarNotification) {
    val configuration = BridgeDependencies.configurationStore.current() ?: return
    if (Channel.NOTIFICATION !in configuration.selectedChannels) return
    val extras = notification.notification.extras
    val title = extras.getCharSequence("android.title")?.toString() ?: return
    val text = extras.getCharSequence("android.text")?.toString() ?: return
    if (!sameBank(title, configuration.bankName)) return
    BridgeDependencies.eventClient.submit(configuration, Channel.NOTIFICATION, UUID.randomUUID().toString(), title, text, Instant.now())
  }
}
