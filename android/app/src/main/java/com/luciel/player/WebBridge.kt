package com.luciel.player

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * window.LucielAndroid – the page's way into Android. Calls arrive on a WebView binder thread; anything touching
 * views/services hops to the main thread. Async results go back through window.LucielAndroidBridge._resolve(id, ok, value).
 */
class WebBridge(private val act: MainActivity) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val prefs = Prefs.get(act)

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface fun info(): String = JSONObject().apply {
        put("version", BuildConfig.VERSION_NAME); put("sdk", Build.VERSION.SDK_INT); put("device", Build.MANUFACTURER + " " + Build.MODEL)
        put("perms", perms())
        put("prefs", JSONObject().apply {
            put("overlay", prefs.overlayEnabled); put("spotifyOnly", prefs.spotifyOnly); put("visualizer", prefs.useVisualizer)
            put("fallbackBpm", prefs.fallbackBpm.toDouble()); put("autoExtMode", prefs.autoSpotifyMode); put("bgPlay", prefs.backgroundPlay)
            put("autoHide", prefs.autoHideSec); put("overlayScene", prefs.overlayScene)
        })
    }.toString()

    fun perms(): JSONObject = JSONObject().apply {
        put("audio", act.checkSelfPermission(if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)
        put("notifications", Build.VERSION.SDK_INT < 33 || act.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        put("mic", act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        put("overlay", Settings.canDrawOverlays(act))
        put("listener", NowPlayingHub.isAccessGranted(act))
    }

    // ------------------------------------------------------------ local playback <-> Media3 session
    @OptIn(UnstableApi::class)
    @JavascriptInterface fun reportState(json: String) {
        val o = JSONObject(json)
        val art = o.optString("art", "")
        val st = WebState(
            id = o.optString("id"), title = o.optString("title"), artist = o.optString("artist"), album = o.optString("album"),
            durationMs = (o.optDouble("duration", 0.0) * 1000).toLong().takeIf { it > 0 } ?: androidx.media3.common.C.TIME_UNSET,
            positionMs = (o.optDouble("position", 0.0) * 1000).toLong(), playing = o.optBoolean("playing"), hasTrack = o.optBoolean("hasTrack"),
            hasPrev = o.optBoolean("hasPrev", true), hasNext = o.optBoolean("hasNext", true),
            artData = if (art.startsWith("data:")) try { Base64.decode(art.substringAfter(","), Base64.DEFAULT) } catch (_: Throwable) { null } else null,
            artUri = if (art.startsWith("content:")) Uri.parse(art) else null,
        )
        // keep the last artwork if this update didn't carry one for the same track
        val prev = lastState
        val merged = if (st.artData == null && st.artUri == null && prev != null && prev.id == st.id && !o.optBoolean("artCleared")) st.copy(artData = prev.artData, artUri = prev.artUri) else st
        lastState = merged
        main.post {
            if (merged.playing || merged.hasTrack) act.ensurePlaybackService()
            PlaybackService.instance?.onWebState(merged)
        }
    }

    // ------------------------------------------------------------ library
    @JavascriptInterface fun scanLibrary(id: Int) = io.execute {
        try { resolve(id, true, LibraryScanner.scan(act).toString()) } catch (e: Throwable) { resolve(id, false, JSONObject.quote(e.message ?: "scan failed")) }
    }
    @JavascriptInterface fun pickAudio(id: Int) = main.post { act.pickAudio(id) }
    @JavascriptInterface fun pickFolder(id: Int, audioOnly: Boolean) = main.post { act.pickTree(id, audioOnly) }
    @JavascriptInterface fun requestAudioPermission(id: Int) = main.post { act.requestAudioPermission(id) }

    /** tag editor: overwrite a MediaStore / SAF file the user picked (asks Android for consent when needed) */
    @JavascriptInterface fun writeFile(id: Int, uri: String, b64: String) = io.execute {
        val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Throwable) { resolve(id, false, JSONObject.quote("bad data")); return@execute }
        main.post { act.writeWithConsent(id, Uri.parse(uri), bytes) }
    }
    @JavascriptInterface fun renameFile(id: Int, uri: String, newName: String) = main.post { act.renameWithConsent(id, Uri.parse(uri), newName) }
    /** "save a copy" for files we can't overwrite */
    @JavascriptInterface fun saveAs(id: Int, name: String, mime: String, b64: String) = io.execute {
        val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Throwable) { resolve(id, false, JSONObject.quote("bad data")); return@execute }
        main.post { act.saveAs(id, name, mime, bytes) }
    }

    // ------------------------------------------------------------ outside players (Spotify ...)
    @JavascriptInterface fun extState(): String = extJson(NowPlayingHub.current).toString()

    /** one animation frame of beat data: "bpm|beat|source|playing|bass|energy|vocal|high|sampleRate|b64(mags)|b64(wave)" */
    @JavascriptInterface fun extFrame(): String {
        val f = NowPlayingHub.beats.frame()
        val n = minOf(f.mags.size, 512)
        val mb = ByteArray(n) { f.mags[it].toByte() }
        return listOf(f.bpm, f.beat, f.source, if (f.playing) 1 else 0, f.bass, f.energy, f.vocal, f.high, f.sampleRate,
            Base64.encodeToString(mb, Base64.NO_WRAP), Base64.encodeToString(f.wave, Base64.NO_WRAP)).joinToString("|")
    }
    @JavascriptInterface fun extCommand(cmd: String, arg: Double) = main.post {
        when (cmd) {
            "toggle" -> NowPlayingHub.playPause(); "play" -> NowPlayingHub.play(); "pause" -> NowPlayingHub.pause()
            "next" -> NowPlayingHub.next(); "prev" -> NowPlayingHub.prev(); "seek" -> NowPlayingHub.seekTo((arg * 1000).toLong())
            "open" -> NowPlayingHub.openPlayerApp(act)
        }
    }
    @JavascriptInterface fun extTap(): Float = NowPlayingHub.beats.tap()
    @JavascriptInterface fun extSetBpm(bpm: Float) { NowPlayingHub.beats.setBpm(bpm) }
    @JavascriptInterface fun extUse(on: Boolean) = main.post { NowPlayingHub.useBeats("app", on) }
    @JavascriptInterface fun beatSource(): String = NowPlayingHub.beats.vizState

    // ------------------------------------------------------------ settings / system
    @JavascriptInterface fun setPref(key: String, value: String) {
        when (key) {
            "overlay" -> prefs.overlayEnabled = value == "true"
            "spotifyOnly" -> { prefs.spotifyOnly = value == "true"; main.post { NowPlayingHub.refresh() } }
            "visualizer" -> { prefs.useVisualizer = value == "true"; main.post { NowPlayingHub.restartBeats() } }
            "fallbackBpm" -> prefs.fallbackBpm = value.toFloatOrNull() ?: 120f
            "autoExtMode" -> prefs.autoSpotifyMode = value == "true"
            "bgPlay" -> prefs.backgroundPlay = value == "true"
            "autoHide" -> prefs.autoHideSec = value.toIntOrNull() ?: 20
            "overlayScene" -> prefs.overlayScene = value
        }
        OverlayController.instance?.refresh()
    }
    @JavascriptInterface fun open(what: String) = main.post { act.openSystem(what) }
    @JavascriptInterface fun systemBars(bg: String, lightIcons: Boolean) = main.post { act.setBars(bg, lightIcons) }
    @JavascriptInterface fun haptic() = main.post { act.window.decorView.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY) }
    @JavascriptInterface fun toast(msg: String) = main.post { android.widget.Toast.makeText(act, msg, android.widget.Toast.LENGTH_SHORT).show() }
    @JavascriptInterface fun exitApp() = main.post { act.moveTaskToBack(true) }

    fun resolve(id: Int, ok: Boolean, valueJson: String) = main.post { act.js("window.LucielAndroidBridge&&LucielAndroidBridge._resolve($id,$ok,$valueJson)") }

    companion object {
        @Volatile var lastState: WebState? = null
        @Volatile var webRef: WeakReference<WebView>? = null
        private val h = Handler(Looper.getMainLooper())

        /** session / audio focus / noisy -> page */
        fun sendCommand(cmd: String, arg: Long = 0) = h.post {
            webRef?.get()?.evaluateJavascript("window.LucielAndroidBridge&&LucielAndroidBridge.cmd(${JSONObject.quote(cmd)},$arg)", null)
        }

        fun extJson(t: ExtTrack?): JSONObject = if (t == null) JSONObject().put("active", false) else JSONObject().apply {
            put("active", true); put("pkg", t.pkg); put("app", t.appLabel); put("spotify", t.isSpotify)
            put("title", t.title); put("artist", t.artist); put("album", t.album); put("genre", t.genre ?: JSONObject.NULL)
            put("duration", t.durationMs / 1000.0); put("position", t.positionNow() / 1000.0); put("playing", t.playing); put("key", t.trackKey)
            put("art", if (NowPlayingHub.artJpeg != null) LocalContent.ORIGIN + "/_n/ext-art?v=" + t.artVersion else JSONObject.NULL)
            t.tint?.let { ti -> put("tint", JSONObject().put("accent", ti.hex(ti.accent)).put("accent2", ti.hex(ti.accent2)).put("bg", ti.hex(ti.bgDark)).put("family", ti.family)) }
            put("scene", SceneGuess.sceneFor(t.genre, t.tint?.family ?: "aero", NowPlayingHub.beats.frame().bpm, 0.4f))
        }
    }
}

@Suppress("unused") private fun JSONArray.isEmpty() = length() == 0
