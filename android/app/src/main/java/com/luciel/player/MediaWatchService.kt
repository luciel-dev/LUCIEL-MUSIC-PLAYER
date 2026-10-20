package com.luciel.player

import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Only used for its "notification access" grant, which is what lets Luciel see other players' media sessions
 * (title / artist / art / play state) – notification contents themselves are ignored. Also hosts the floating overlay
 * so it lives as long as the access is on (no extra foreground service needed).
 */
class MediaWatchService : NotificationListenerService() {
    private var overlay: OverlayController? = null

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        NowPlayingHub.attach(this)
        overlay = OverlayController(this).also { it.start() }
    }

    override fun onListenerDisconnected() {
        overlay?.stop(); overlay = null
        NowPlayingHub.detach()
        instance = null
        // ask to be re-bound (e.g. after an OEM battery saver killed us)
        try { requestRebind(ComponentName(this, MediaWatchService::class.java)) } catch (_: Throwable) {}
        super.onListenerDisconnected()
    }

    override fun onDestroy() { overlay?.stop(); overlay = null; if (instance === this) instance = null; super.onDestroy() }

    override fun onNotificationPosted(sbn: StatusBarNotification?) { /* media sessions drive everything */ }
    override fun onNotificationRemoved(sbn: StatusBarNotification?) {}

    companion object {
        @Volatile var instance: MediaWatchService? = null
        fun overlay() = instance?.overlay
    }
}
