package com.luciel.player

import android.content.Context
import android.content.SharedPreferences

/** Small typed wrapper around the app's SharedPreferences (shared by the app, the overlay and the listener). */
class Prefs(ctx: Context) {
    val sp: SharedPreferences = ctx.applicationContext.getSharedPreferences("luciel", Context.MODE_PRIVATE)

    var onboarded: Boolean get() = sp.getBoolean("onboarded", false); set(v) = sp.edit().putBoolean("onboarded", v).apply()
    /** floating Lucielle over other apps when an outside player is playing */
    var overlayEnabled: Boolean get() = sp.getBoolean("overlay", true); set(v) = sp.edit().putBoolean("overlay", v).apply()
    /** only react to Spotify (com.spotify.music) – otherwise any player (YouTube Music, Poweramp, ...) */
    var spotifyOnly: Boolean get() = sp.getBoolean("spotifyOnly", false); set(v) = sp.edit().putBoolean("spotifyOnly", v).apply()
    /** hide the overlay this many seconds after the outside player pauses (0 = keep it) */
    var autoHideSec: Int get() = sp.getInt("autoHide", 20); set(v) = sp.edit().putInt("autoHide", v).apply()
    /** 0 = small, 1 = medium, 2 = large; free resize stores a custom width in dp */
    var overlaySizeDp: Int get() = sp.getInt("overlayDp", 200); set(v) = sp.edit().putInt("overlayDp", v.coerceIn(120, 420)).apply()
    var overlayX: Int get() = sp.getInt("overlayX", -1); set(v) = sp.edit().putInt("overlayX", v).apply()
    var overlayY: Int get() = sp.getInt("overlayY", -1); set(v) = sp.edit().putInt("overlayY", v).apply()
    var overlayCollapsed: Boolean get() = sp.getBoolean("collapsed", false); set(v) = sp.edit().putBoolean("collapsed", v).apply()
    var overlayOpacity: Int get() = sp.getInt("opacity", 100); set(v) = sp.edit().putInt("opacity", v.coerceIn(30, 100)).apply()
    /** "auto" or a scene id from art/scenes.json */
    var overlayScene: String get() = sp.getString("overlayScene", "auto") ?: "auto"; set(v) = sp.edit().putString("overlayScene", v).apply()
    /** listen to the output mix with android.media.audiofx.Visualizer (needs RECORD_AUDIO) */
    var useVisualizer: Boolean get() = sp.getBoolean("visualizer", true); set(v) = sp.edit().putBoolean("visualizer", v).apply()
    /** fallback tempo when no audio levels are available */
    var fallbackBpm: Float get() = sp.getFloat("fallbackBpm", 120f); set(v) = sp.edit().putFloat("fallbackBpm", v.coerceIn(50f, 220f)).apply()
    /** inside the app: switch the scene view to the outside player automatically when it starts and Luciel is idle */
    var autoSpotifyMode: Boolean get() = sp.getBoolean("autoExtMode", true); set(v) = sp.edit().putBoolean("autoExtMode", v).apply()
    /** keep playing (WebView alive) when the user backs out of the app */
    var backgroundPlay: Boolean get() = sp.getBoolean("bgPlay", true); set(v) = sp.edit().putBoolean("bgPlay", v).apply()

    companion object {
        @Volatile private var inst: Prefs? = null
        fun get(ctx: Context): Prefs = inst ?: synchronized(this) { inst ?: Prefs(ctx).also { inst = it } }
        const val SPOTIFY = "com.spotify.music"
    }
}
