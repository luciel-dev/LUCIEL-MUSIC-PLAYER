package com.luciel.player

import android.Manifest
import android.content.Intent
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
            put("autoHide", prefs.autoHideSec); put("overlayScene", prefs.overlayScene); put("autoFloater", prefs.autoFloater)
            put("overlayMode", prefs.overlayMode); put("floaterClosed", prefs.floaterClosed)
            put("spotifyInstalled", try { act.packageManager.getLaunchIntentForPackage(Prefs.SPOTIFY) != null } catch (_: Throwable) { false })
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
            buffering = o.optBoolean("buffering"), bpm = o.optDouble("bpm", 0.0).toFloat(), beatPos = o.optDouble("beatPos", 0.0),
            theme = themeOf(o), sceneId = o.optString("scene"), mascotOn = o.optBoolean("mascot", true),
            sceneArt = o.optString("sceneArt", "").let { a -> if (a.startsWith("data:")) try { Base64.decode(a.substringAfter(","), Base64.DEFAULT) } catch (_: Throwable) { null } else null },
        )
        // keep the last artwork if this update didn't carry one for the same track
        val prev = lastState
        var merged = if (st.artData == null && st.artUri == null && prev != null && prev.id == st.id && !o.optBoolean("artCleared")) st.copy(artData = prev.artData, artUri = prev.artUri) else st
        // the pack scene picture arrives once it has loaded; keep it while the scene stays the same
        if (merged.sceneArt == null && prev?.sceneArt != null && prev.sceneId == merged.sceneId) merged = merged.copy(sceneArt = prev.sceneArt)
        lastState = merged
        main.post {
            if (merged.playing || merged.hasTrack) act.ensurePlaybackService()
            PlaybackService.instance?.onWebState(merged)
            FloaterController.onWebState(merged)
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
    // ------------------------------------------------------------ Luciel's look -> floater / Spotify card
    /** the page's resolved stage (scene, outfit, palette, visualizer); persisted so the overlays keep it after a restart */
    @JavascriptInterface fun visualState(json: String) {
        try { VisualHub.set(json) } catch (e: Throwable) { DebugLog.add("visual", "bad visual state: ${e.message}") }
    }
    /** path of an already extracted pack picture with this key and source size, or "" */
    @JavascriptInterface fun visualHas(key: String, size: Long): String = VisualHub.existing(key, size)?.absolutePath ?: ""
    /** store a pack picture (base64) for the native views; returns its file path ("" on failure) */
    @JavascriptInterface fun visualPut(key: String, size: Long, b64: String): String = try {
        VisualHub.put(key, size, Base64.decode(b64.substringAfter(","), Base64.DEFAULT))?.absolutePath ?: ""
    } catch (e: Throwable) { DebugLog.add("visual", "store $key failed: ${e.message}"); "" }

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
            "autoFloater" -> { prefs.autoFloater = value == "true"; main.post { FloaterController.autoSettingChanged(value == "true") } }
            "overlayMode" -> prefs.overlayMode = value
        }
        OverlayController.instance?.refresh()
        FloaterController.update()
    }
    @JavascriptInterface fun open(what: String) = main.post { act.openSystem(what) }
    @JavascriptInterface fun systemBars(bg: String, lightIcons: Boolean) = main.post { act.setBars(bg, lightIcons) }
    @JavascriptInterface fun haptic() = main.post { act.window.decorView.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY) }
    @JavascriptInterface fun toast(msg: String) = main.post { android.widget.Toast.makeText(act, msg, android.widget.Toast.LENGTH_SHORT).show() }
    /** last playback fallback: decode with the phone's codecs into a cached WAV the page can play */
    @JavascriptInterface fun decodeAudio(id: Int, uri: String) = io.execute {
        DebugLog.add("native", "decoding with the phone's decoder: $uri")
        try {
            val f = AudioDecoder.toWav(act, Uri.parse(uri))
            DebugLog.add("native", "decoded copy ready (${f.length() / 1024} KB)")
            resolve(id, true, JSONObject.quote(LocalContent.mediaUrl(Uri.fromFile(f))))
        } catch (e: Throwable) {
            DebugLog.add("native", "phone decoder failed: ${e.message}")
            resolve(id, false, JSONObject.quote(e.message ?: "decode failed"))
        }
    }
    /** playback debug log (Settings > Debug log) */
    @JavascriptInterface fun log(msg: String) = DebugLog.add("web", msg.take(400))
    @JavascriptInterface fun debugLog(): String = DebugLog.text()
    @JavascriptInterface fun clearDebugLog() = DebugLog.clear()
    @JavascriptInterface fun exitApp() = main.post { act.moveTaskToBack(true) }

    /** Luciel's own floating mini player: "show" = Pop out (then step aside so it floats over the home screen / other apps), "hide" = close */
    @JavascriptInterface fun floater(cmd: String) = main.post {
        when (cmd) {
            "show" -> if (FloaterController.popOut()) act.moveTaskToBack(true) else act.openSystem("overlay")
            "hide" -> FloaterController.close()
        }
    }
    @JavascriptInterface fun floaterState(): String = JSONObject().put("showing", FloaterController.isShowing).put("poppedOut", FloaterController.poppedOut)
        .put("decision", FloaterController.decision().name).put("rect", FloaterController.windowRect()?.let { JSONArray(it.toList()) } ?: JSONObject.NULL).toString()
    /** Spotify overlay card from the Spotify tab: "on" / "off" / "show" (= on + step aside so it floats now) */
    @JavascriptInterface fun overlayCard(cmd: String) = main.post {
        when (cmd) {
            "on", "show" -> { prefs.overlayEnabled = true; DebugLog.add("overlay", "Spotify overlay turned on (Spotify tab)") }
            "off" -> { prefs.overlayEnabled = false; DebugLog.add("overlay", "Spotify overlay turned off (Spotify tab)") }
        }
        OverlayController.instance?.refresh(); FloaterController.update()
        if (cmd == "show") { if (Settings.canDrawOverlays(act)) act.moveTaskToBack(true) else act.openSystem("overlay") }
    }
    /** deep link into Spotify (search, Liked Songs …); falls back to the web player URL. Returns how it opened. */
    @JavascriptInterface fun openLink(appUri: String, webUrl: String): String {
        val pm = act.packageManager
        val app = Intent(Intent.ACTION_VIEW, Uri.parse(appUri)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (appUri.startsWith("spotify:")) app.setPackage(Prefs.SPOTIFY)
        val how = if (appUri.isNotEmpty() && app.resolveActivity(pm) != null) { main.post { try { act.startActivity(app) } catch (_: Throwable) {} }; "app" }
            else { main.post { try { act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(webUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Throwable) {} }; "web" }
        DebugLog.add("spotify", "open $appUri ($how)")
        return how
    }
    /** tap on the stage: hide the system bars (swipe from an edge brings them back) */
    @JavascriptInterface fun immersive(on: Boolean) = main.post { act.setBarsHidden(on) }

    // ---- optional Spotify connection (Web API). Tokens never leave the native side.
    private val spotify get() = SpotifyConnect.get(act)
    @JavascriptInterface fun spotifyStatus(): String = spotify.status().toString()
    /** "" clears it; returns the new status, or {"error":"format"} for something that isn't a Client ID */
    @JavascriptInterface fun spotifySetClientId(id: String): String {
        val t = id.trim()
        if (t.isNotEmpty() && !SpotifyClient.validClientId(t)) return JSONObject().put("error", "format").toString()
        spotify.clientId = t; DebugLog.add("spotify", if (t.isEmpty()) "client id cleared" else "client id set")
        return spotify.status().toString()
    }
    @JavascriptInterface fun spotifyConnect(): String {
        val url = spotify.begin() ?: return "no-client-id"
        main.post { SpotifyConnect.launch(act, url) }
        return "opened"
    }
    /** wake the phone's Spotify in the background (see NowPlayingHub.wakeSpotify) */
    @JavascriptInterface fun spotifyWake(): String { val r = NowPlayingHub.wakeSpotify(act.applicationContext); DebugLog.add("spotify", "wake Spotify: $r"); return r }
    /** names this phone may have in Spotify's device list */
    @JavascriptInterface fun spotifyDeviceNames(): String = org.json.JSONArray().apply {
        try { android.provider.Settings.Global.getString(act.contentResolver, android.provider.Settings.Global.DEVICE_NAME)?.let { put(it) } } catch (_: Exception) {}
        put(Build.MODEL); put(Build.MANUFACTURER + " " + Build.MODEL)
    }.toString()
    @JavascriptInterface fun spotifyDisconnect() { spotify.disconnect(); DebugLog.add("spotify", "disconnected") }
    /** resolves {status, body, retryAfter} (body = parsed JSON or null) */
    @JavascriptInterface fun spotifyApi(id: Int, method: String, path: String, body: String) = net.execute {
        val r = try { spotify.api(method, path, body.ifEmpty { null }) } catch (e: Exception) { HttpResp(0, "") }
        val parsed: Any = try { if (r.body.isBlank()) JSONObject.NULL else org.json.JSONTokener(r.body).nextValue() } catch (_: Exception) { JSONObject.NULL }
        if (r.code !in 200..299) DebugLog.add("spotify", "api $method ${path.substringBefore('?')} -> ${r.code}")
        resolve(id, true, JSONObject().put("status", r.code).put("body", parsed).put("retryAfter", r.headers["retry-after"]?.toIntOrNull() ?: 0).toString())
    }

    fun resolve(id: Int, ok: Boolean, valueJson: String) = main.post { act.js("window.LucielAndroidBridge&&LucielAndroidBridge._resolve($id,$ok,$valueJson)") }

    companion object {
        @Volatile var lastState: WebState? = null
        @Volatile var webRef: WeakReference<WebView>? = null
        private val h = Handler(Looper.getMainLooper())

        /** session / audio focus / noisy -> page */
        fun sendCommand(cmd: String, arg: Long = 0) = h.post {
            webRef?.get()?.evaluateJavascript("window.LucielAndroidBridge&&LucielAndroidBridge.cmd(${JSONObject.quote(cmd)},$arg)", null)
        }

        private val net = java.util.concurrent.Executors.newFixedThreadPool(3)
        /** native -> page event (e.g. the Spotify sign-in finished) */
        fun pushEvent(name: String, data: JSONObject) = h.post {
            webRef?.get()?.evaluateJavascript("window.LucielAndroidBridge&&LucielAndroidBridge.event&&LucielAndroidBridge.event(${JSONObject.quote(name)},$data)", null)
        }

        fun themeOf(o: JSONObject): FloaterTheme = Themes.of(o)

        fun extJson(t: ExtTrack?): JSONObject = if (t == null) JSONObject().put("active", false) else JSONObject().apply {
            put("active", true); put("pkg", t.pkg); put("app", t.appLabel); put("spotify", t.isSpotify)
            put("title", t.title); put("artist", t.artist); put("album", t.album); put("genre", t.genre ?: JSONObject.NULL)
            put("duration", t.durationMs / 1000.0); put("position", t.positionNow() / 1000.0); put("playing", t.playing); put("key", t.trackKey)
            put("art", if (NowPlayingHub.artJpeg != null) LocalContent.ORIGIN + "/_n/ext-art?v=" + t.artVersion else JSONObject.NULL)
            t.tint?.let { ti -> put("tint", JSONObject().put("accent", ti.hex(ti.accent)).put("accent2", ti.hex(ti.accent2)).put("bg", ti.hex(ti.bgDark)).put("family", ti.family)) }
            val fr = NowPlayingHub.beats.frame()
            put("scene", SceneGuess.sceneFor(t.genre, t.tint?.family ?: "aero", fr.bpm, 0.4f))
            // sync: the page extrapolates position = position + (Date.now() - posWall) * speed (while playing), and logs
            // how long a session event took to reach the screen (evAt = wall-clock time of the media-session callback)
            val wall = System.currentTimeMillis(); val el = android.os.SystemClock.elapsedRealtime()
            put("posWall", wall); put("speed", t.speed.toDouble()); put("evAt", wall - (el - t.eventAt).coerceAtLeast(0))
            put("bpm", fr.bpm.toDouble()); put("bpmSource", fr.source); put("tempo", TempoLabel.of(fr.bpm, fr.source))
        }
    }
}

@Suppress("unused") private fun JSONArray.isEmpty() = length() == 0
