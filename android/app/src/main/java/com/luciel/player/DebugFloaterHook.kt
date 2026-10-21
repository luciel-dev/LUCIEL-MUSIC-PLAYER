package com.luciel.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.util.Log

/**
 * DEBUG BUILDS ONLY (never registered in release): feeds a fake "now playing" into the floater so it can be tested on an
 * emulator whose WebView can't run the page. `adb shell am broadcast -a com.luciel.player.DEBUG_FLOATER --es palette red ...`
 */
object DebugFloaterHook {
    const val ACTION = "com.luciel.player.DEBUG_FLOATER"
    private val PALETTES = mapOf(
        "aero" to listOf("#1e94ee", "#74ccff", "#b4d3ec", "#6f9cc6", "#12253a", "#07162a", "#94dcff", "#e6ecf2", "#b9c6d3", "#8797a9", "#46556a"),
        "blue" to listOf("#3d8bff", "#5fe2ff", "#081634", "#02060f", "#e4eeff", "#010818", "#5fe2ff", "#4a6296", "#2a3d68", "#18264a", "#050b1c"),
        "red" to listOf("#ff2d48", "#ff8c5e", "#1a0408", "#060102", "#ffe7e9", "#120103", "#ff4a5b", "#8a2a33", "#561019", "#320810", "#0d0103"),
        "slime" to listOf("#7dff1a", "#d6ff3d", "#071603", "#010401", "#eaffd6", "#000800", "#7dff1a", "#3f6326", "#213a12", "#122208", "#030801"),
    )
    private val SONGS = listOf(Triple("Neon Heartbeat", "Aurora Static", "Night Signals"), Triple("Glass Garden", "Mira Vale", "Bloom"), Triple("Static Bloom", "The Ember Line", "Low Light"))
    private var idx = 0
    var active = false; private set
    private var fake: WebState? = null
    private var cover: ByteArray? = null

    fun register(ctx: Context) {
        if (!BuildConfig.DEBUG) return
        val r = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = handle(c, i) }
        androidx.core.content.ContextCompat.registerReceiver(ctx, r, IntentFilter(ACTION), androidx.core.content.ContextCompat.RECEIVER_EXPORTED)
    }

    private fun handle(ctx: Context, i: Intent) {
        // `--es decode content://...` : run the native decoder fallback (AudioDecoder) on a file and log the result
        i.getStringExtra("decode")?.let { u ->
            Thread {
                val t0 = SystemClock.elapsedRealtime()
                try { val f = AudioDecoder.toWav(ctx, android.net.Uri.parse(u)); DebugLog.add("debug", "decode OK $u -> ${f.name} ${f.length()} B in ${SystemClock.elapsedRealtime() - t0} ms") }
                catch (e: Throwable) { DebugLog.add("debug", "decode FAILED $u: ${e.message}") }
            }.start()
            return
        }
        active = true
        val pal = i.getStringExtra("palette") ?: "aero"
        val skin = i.getStringExtra("skin") ?: "aero"
        val p = (PALETTES[pal] ?: PALETTES.getValue("aero")).map { CssColor.parse(it, 0) }
        i.getStringExtra("cover")?.let { a -> cover = try { ctx.assets.open("www/$a").use { it.readBytes() } } catch (_: Throwable) { null } }
        i.getStringExtra("mode")?.let { Prefs.get(ctx).floaterMode = it }
        if (i.hasExtra("x")) Prefs.get(ctx).floaterX = i.getIntExtra("x", -1)
        if (i.hasExtra("y")) Prefs.get(ctx).floaterY = i.getIntExtra("y", -1)
        val (t, a, al) = SONGS[idx % SONGS.size]
        val st = WebState(id = "dbg$idx", title = i.getStringExtra("title") ?: t, artist = a, album = al, durationMs = 214_000, positionMs = i.getLongExtra("pos", 63_000),
            playing = i.getBooleanExtra("playing", true), hasTrack = true, artData = cover, bpm = i.getFloatExtra("bpm", 124f), beatPos = 130.0,
            theme = FloaterTheme(skin, pal, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10]),
            sceneId = i.getStringExtra("scene") ?: "synthwave")
        fake = st
        FloaterController.hide()          // re-create with the new mode / theme
        FloaterController.onWebState(st)
        when (i.getStringExtra("cmd")) { "popout" -> FloaterController.popOut(); "close" -> FloaterController.close() }
        Log.i("LucielFloater", "debug state $pal/$skin playing=${st.playing}")
    }

    /** floater buttons while faking: act like a player so the UI can be checked */
    fun command(cmd: String, arg: Long): Boolean {
        val s = fake ?: return false
        if (!active) return false
        Log.i("LucielFloater", "debug cmd $cmd $arg")
        val now = SystemClock.elapsedRealtime()
        val n = when (cmd) {
            "toggle" -> s.copy(playing = !s.playing, positionMs = s.positionNow(now), beatPos = s.beatNow(now), reportedAt = now)
            "play" -> s.copy(playing = true, reportedAt = now)
            "pause" -> s.copy(playing = false, positionMs = s.positionNow(now), reportedAt = now)
            "next", "prev" -> { idx = (idx + if (cmd == "next") 1 else SONGS.size - 1) % SONGS.size; val (t, a, al) = SONGS[idx]; s.copy(id = "dbg$idx", title = t, artist = a, album = al, positionMs = 0, beatPos = 0.0, reportedAt = now) }
            "seek" -> s.copy(positionMs = arg, reportedAt = now)
            else -> s
        }
        fake = n; FloaterController.onWebState(n); return true
    }
}
