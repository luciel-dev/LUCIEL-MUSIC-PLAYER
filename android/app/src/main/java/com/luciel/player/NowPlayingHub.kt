package com.luciel.player

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/** What an outside player (Spotify, YouTube Music, ...) is doing right now. */
data class ExtTrack(
    val pkg: String, val appLabel: String, val title: String, val artist: String, val album: String,
    val durationMs: Long, val playing: Boolean, val positionMs: Long, val positionAt: Long, val speed: Float,
    val artVersion: Int, val tint: Tint?, val genre: String?, val trackKey: String,
    /** elapsedRealtime of the media-session callback this state came from (for the sync latency log) */
    val eventAt: Long = 0L,
) {
    fun positionNow(now: Long = SystemClock.elapsedRealtime()): Long =
        if (!playing || positionAt <= 0) positionMs else (positionMs + ((now - positionAt) * speed).toLong()).coerceIn(0, if (durationMs > 0) durationMs else Long.MAX_VALUE)
    val isSpotify get() = pkg == Prefs.SPOTIFY
}

/**
 * Follows other apps' MediaSessions through MediaSessionManager.getActiveSessions(), which Android only allows for an
 * enabled NotificationListenerService (the "notification access" switch). Mirrors transport controls back through the
 * MediaController. No Spotify login or Web API is used.
 */
object NowPlayingHub {
    private const val TAG = "LucielHub"
    private lateinit var app: Context
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var msm: MediaSessionManager? = null
    private var listenerComp: ComponentName? = null
    private var controller: MediaController? = null
    private var lastPkg: String? = null
    private var artVersion = 0
    private var artReq = 0
    private var lastArtKey: String? = null
    private var lastEventAt = 0L
    private var lastLoggedKey: String? = null
    @Volatile var artJpeg: ByteArray? = null; private set
    /** covers by version (the page's URL names a version: always serve exactly that picture, never a newer/older one) */
    private val artByVersion = object : LinkedHashMap<Int, ByteArray>(8, 0.75f, true) { override fun removeEldestEntry(e: MutableMap.MutableEntry<Int, ByteArray>?) = size > 6 }
    /** covers by song (coming back to a song, or a later metadata update without a picture) */
    private class Cover(val jpeg: ByteArray, val bmp: Bitmap, val tint: Tint?)
    private val coverBySong = object : LinkedHashMap<String, Cover>(16, 0.75f, true) { override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Cover>?) = size > 30 }
    fun artFor(version: Int): ByteArray? = synchronized(artByVersion) { artByVersion[version] } ?: artJpeg
    @Volatile var artBitmap: Bitmap? = null; private set
    private var tint: Tint? = null
    @Volatile var current: ExtTrack? = null; private set
    lateinit var beats: BeatEngine; private set
    val listeners = CopyOnWriteArrayList<(ExtTrack?) -> Unit>()
    /** consumers that need beat data right now (overlay visible / in-app Spotify mode visible) */
    private val beatUsers = mutableSetOf<String>()

    fun init(ctx: Context) { app = ctx.applicationContext; beats = BeatEngine(app) }

    fun isAccessGranted(ctx: Context): Boolean {
        val flat = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(ctx, MediaWatchService::class.java)
        return flat.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { refresh() }

    /** called by MediaWatchService once the system has connected it */
    fun attach(ctx: Context) {
        val m = ctx.getSystemService(MediaSessionManager::class.java) ?: return
        msm = m; listenerComp = ComponentName(ctx, MediaWatchService::class.java)
        try { m.addOnActiveSessionsChangedListener(sessionsChanged, listenerComp, main) } catch (e: SecurityException) { Log.w(TAG, "no access", e); return }
        refresh()
    }

    fun detach() {
        try { msm?.removeOnActiveSessionsChangedListener(sessionsChanged) } catch (_: Throwable) {}
        controller?.unregisterCallback(cb); controller = null; msm = null
        publish(null)
    }

    val attached get() = msm != null

    fun refresh() {
        val m = msm ?: return
        val list = try { m.getActiveSessions(listenerComp) } catch (e: SecurityException) { emptyList() }
        val infos = list.mapIndexed { i, c -> SessionInfo(c.packageName, c.playbackState?.state == PlaybackState.STATE_PLAYING || c.playbackState?.state == PlaybackState.STATE_BUFFERING, c.metadata != null, i) }
        val pick = SessionPicker.pick(infos, app.packageName, Prefs.get(app).spotifyOnly, lastPkg)
        val next = pick?.let { p -> list.first { it.packageName == p.pkg } }
        if (next?.sessionToken != controller?.sessionToken) {
            controller?.unregisterCallback(cb)
            controller = next
            next?.registerCallback(cb, main)
            if (next != null) lastPkg = next.packageName
        }
        update()
    }

    private val cb = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) { lastEventAt = SystemClock.elapsedRealtime(); update(); if (state?.state == PlaybackState.STATE_PLAYING) main.postDelayed({ refresh() }, 300) }
        override fun onMetadataChanged(metadata: MediaMetadata?) { lastEventAt = SystemClock.elapsedRealtime(); update() }
        override fun onSessionDestroyed() { main.post { refresh() } }
    }

    private fun label(pkg: String): String = try {
        val pm = app.packageManager; pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Throwable) { if (pkg == Prefs.SPOTIFY) "Spotify" else pkg }

    private fun update() {
        val c = controller
        if (c == null) { publish(null); return }
        val md = c.metadata; val ps = c.playbackState
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""
        val artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: ""
        val album = md?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""
        val dur = md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
        val playing = ps?.state == PlaybackState.STATE_PLAYING
        val key = "${c.packageName}|$title|$artist|$album"
        val prev = current
        val now = SystemClock.elapsedRealtime()
        val trackChanged = prev?.trackKey != key
        if (trackChanged) {
            beats.trackChanged()
            // never show the previous song's cover under the new title: drop it until the new one is decoded
            artBitmap = null; artJpeg = null; tint = null; artReq++   // (also cancels a decode still running for the old song)
            coverBySong[key]?.let { cv -> artVersion++; artBitmap = cv.bmp; artJpeg = cv.jpeg; tint = cv.tint; synchronized(artByVersion) { artByVersion[artVersion] = cv.jpeg } }
            if (title.isNotEmpty() && key != lastLoggedKey) { lastLoggedKey = key; DebugLog.add("spotify", "session: new song “$title” – $artist (${c.packageName})") }
        }
        // album art: bitmap in the metadata, or a content URI (content only – no network). Spotify often sends the
        // title first and the picture in a second metadata update, so the bitmap itself is part of the key.
        val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART) ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        val uri = ArtRules.pickUri(md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI), md?.getString(MediaMetadata.METADATA_KEY_ART_URI), md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI))
        // NB: every MediaController.getMetadata() call unparcels NEW Bitmap objects, so the bitmap's identity
        // (generationId) changes on every callback. 1.1.3 keyed on it -> a fresh decode + a new cover URL on each
        // playback-state tick, and the page's hero <img> was replaced before it ever finished loading (empty box).
        // Key on the picture's content instead.
        val artKey = ArtRules.key(key, uri, bmp?.width ?: 0, bmp?.height ?: 0, ArtRules.sample(bmp))
        if (artKey != lastArtKey) { lastArtKey = artKey; setArt(bmp, uri, key) }
        val t = ExtTrack(
            pkg = c.packageName, appLabel = label(c.packageName), title = title, artist = artist, album = album,
            durationMs = dur, playing = playing, positionMs = ps?.position ?: 0L,
            positionAt = ps?.lastPositionUpdateTime?.takeIf { it > 0 } ?: now, speed = ps?.playbackSpeed?.takeIf { it > 0f } ?: 1f,
            artVersion = artVersion, tint = tint, genre = SceneGuess.genre(title, album, artist), trackKey = key,
            eventAt = if (lastEventAt > 0) lastEventAt else now,
        )
        beats.playing = playing
        publish(t)
    }

    private fun setArt(bmp: Bitmap?, uri: String?, songKey: String) {
        if (bmp == null && uri.isNullOrBlank()) return            // keep what we have (cleared on a song change); a picture may follow
        val v = ++artReq
        val src = if (bmp != null) "bitmap" else uri!!.substringBefore(':')
        val t0 = SystemClock.elapsedRealtime()
        io.execute {
            try {
                var b = bmp
                if (b == null && uri != null) b = loadUri(uri)
                if (b == null) DebugLog.add("spotify", "cover: no picture from $src")
                if (b == null || b.isRecycled) return@execute
                val sc = 512f / maxOf(b.width, b.height)
                val small = if (sc < 1f) Bitmap.createScaledBitmap(b, (b.width * sc).toInt().coerceAtLeast(1), (b.height * sc).toInt().coerceAtLeast(1), true) else b.copy(Bitmap.Config.ARGB_8888, false)
                val tiny = Bitmap.createScaledBitmap(small, 48, 48, true)
                val px = IntArray(48 * 48); tiny.getPixels(px, 0, 48, 0, 0, 48, 48)
                val ti = CoverPalette.extract(px)
                val out = ByteArrayOutputStream(); small.compress(Bitmap.CompressFormat.JPEG, 88, out)
                val jpeg = out.toByteArray()
                main.post {
                    if (v != artReq) return@post
                    if (artJpeg?.contentEquals(jpeg) == true) return@post   // same picture again: keep the URL the page already has
                    artVersion++                                   // new URL for the page: /_n/ext-art?v=<artVersion>
                    artBitmap = small; artJpeg = jpeg; tint = ti
                    synchronized(artByVersion) { artByVersion[artVersion] = jpeg }
                    coverBySong[songKey] = Cover(jpeg, small, ti)
                    DebugLog.add("spotify", "cover ready ($src, ${SystemClock.elapsedRealtime() - t0} ms)")
                    lastEventAt = SystemClock.elapsedRealtime()
                    update()
                }
            } catch (t: Throwable) { Log.w(TAG, "art", t) }
        }
    }

    /** cover from a URI: content:// / file / resource via ContentResolver, Spotify's "spotify:image:<id>" and https
     *  pictures from Spotify's public image CDN only */
    private fun loadUri(uri: String): Bitmap? {
        val u = ArtRules.resolve(uri) ?: return null
        return if (u.startsWith("https://")) ImageProxy.fetchBitmap(app, u, 640)
        else app.contentResolver.openInputStream(Uri.parse(u))?.use { BitmapFactory.decodeStream(it) }
    }

    private fun publish(t: ExtTrack?) {
        current = t
        syncBeats()
        for (l in listeners) try { l(t) } catch (e: Throwable) { Log.w(TAG, "listener", e) }
    }

    // ---- transport (mirrors the outside player's own controls)
    /**
     * 1.1.5: make the phone's Spotify a Spotify Connect device without opening its UI, so the Web API can start a song
     * on it. Its media session if it has one (play), otherwise a media-button press sent to Spotify's receiver, which
     * starts its playback service in the background. Returns what was tried ("session" / "media-button" / "not-installed").
     */
    fun wakeSpotify(ctx: Context): String {
        val c = try { msm?.getActiveSessions(listenerComp)?.firstOrNull { it.packageName == Prefs.SPOTIFY } } catch (_: SecurityException) { null }
        if (c != null) { c.transportControls.play(); return "session" }
        if (ctx.packageManager.getLaunchIntentForPackage(Prefs.SPOTIFY) == null) return "not-installed"
        val t = SystemClock.uptimeMillis()
        for (action in intArrayOf(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.ACTION_UP)) {
            val i = android.content.Intent(android.content.Intent.ACTION_MEDIA_BUTTON).setPackage(Prefs.SPOTIFY)
                .putExtra(android.content.Intent.EXTRA_KEY_EVENT, android.view.KeyEvent(t, t, action, android.view.KeyEvent.KEYCODE_MEDIA_PLAY, 0))
            try { ctx.sendBroadcast(i) } catch (_: Exception) {}
        }
        return "media-button"
    }

    fun playPause() { val c = controller ?: return; if (c.playbackState?.state == PlaybackState.STATE_PLAYING) c.transportControls.pause() else c.transportControls.play() }
    fun play() { controller?.transportControls?.play() }
    fun pause() { controller?.transportControls?.pause() }
    fun next() { controller?.transportControls?.skipToNext() }
    fun prev() { controller?.transportControls?.skipToPrevious() }
    fun seekTo(ms: Long) { controller?.transportControls?.seekTo(ms) }
    /** open the outside player's own UI */
    fun openPlayerApp(ctx: Context) {
        val c = controller ?: return
        try { c.sessionActivity?.send() ; return } catch (_: Throwable) {}
        ctx.packageManager.getLaunchIntentForPackage(c.packageName)?.let { it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK); ctx.startActivity(it) }
    }

    // ---- beat engine lifecycle: only listen while someone shows visuals and the player plays
    fun useBeats(who: String, on: Boolean) { if (on) beatUsers.add(who) else beatUsers.remove(who); syncBeats() }
    private fun syncBeats() {
        val want = beatUsers.isNotEmpty() && current?.playing == true
        if (want) beats.start() else beats.stop()
    }
    fun restartBeats() { beats.stop(); syncBeats() }
}

/** cover-art bookkeeping rules (unit-tested): what identifies "a new picture" for a song */
object ArtRules {
    fun key(trackKey: String, uri: String?, w: Int, h: Int, sample: Int): String = trackKey + "|" + (uri ?: "") + "|" + (if (w > 0) "${w}x$h#$sample" else "-")
    /** a cheap fingerprint of the picture's pixels (8×8 samples), stable across parcel copies of the same bitmap */
    fun sample(b: Bitmap?): Int {
        if (b == null || b.isRecycled || b.width <= 0) return 0
        return try { var h = 17; for (y in 0 until 8) for (x in 0 until 8) h = h * 31 + b.getPixel((b.width - 1) * x / 7, (b.height - 1) * y / 7); h } catch (_: Throwable) { b.width * 31 + b.height }
    }
    /** the first usable cover URI among ALBUM_ART_URI, ART_URI, DISPLAY_ICON_URI */
    fun pickUri(vararg u: String?): String? = u.firstOrNull { !it.isNullOrBlank() && resolve(it) != null }
    /** URI we can load: content / file / android.resource as is; spotify:image:<id> -> Spotify's image CDN; https only from Spotify's CDNs */
    fun resolve(uri: String): String? {
        val u = uri.trim()
        Regex("^spotify:image:([0-9a-fA-F]{16,64})$").find(u)?.let { return "https://i.scdn.co/image/" + it.groupValues[1].lowercase() }
        if (u.startsWith("content:") || u.startsWith("file:") || u.startsWith("android.resource:")) return u
        if (u.startsWith("https://") && ImageProxy.allowed(u)) return u
        return null
    }
}
