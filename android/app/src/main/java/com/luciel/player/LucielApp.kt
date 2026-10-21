package com.luciel.player

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class LucielApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_OVERLAY, getString(R.string.overlay_channel), NotificationManager.IMPORTANCE_MIN).apply {
            description = "Shown only while the floating Lucielle is visible"; setShowBadge(false)
        })
        Prefs.get(this)
        VisualHub.init(this)
        NowPlayingHub.init(this)
        FloaterController.init(this)
        if (BuildConfig.DEBUG) DebugFloaterHook.register(this)
    }
    companion object { const val CH_OVERLAY = "overlay" }
}
