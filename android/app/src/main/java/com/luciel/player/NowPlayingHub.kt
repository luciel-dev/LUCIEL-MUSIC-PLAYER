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
    private var lastArtKey: String? = null
    @Volatile var artJpeg: ByteArray? = null; private set
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
        override fun onPlaybackStateChanged(state: PlaybackState?) { update(); if (state?.state == PlaybackState.STATE_PLAYING) main.postDelayed({ refresh() }, 300) }
        override fun onMetadataChanged(metadata: MediaMetadata?) = update()
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
        if (prev?.trackKey != key) beats.trackChanged()
        // album art: bitmap in the metadata, or a content/http URI (content only – no network)
        val artKey = key + "|" + (md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: md?.getString(MediaMetadata.METADATA_KEY_ART_URI) ?: "")
        if (artKey != lastArtKey) {
            lastArtKey = artKey
            val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART) ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            val uri = md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: md?.getString(MediaMetadata.METADATA_KEY_ART_URI)
            setArt(bmp, uri)
        }
        val t = ExtTrack(
            pkg = c.packageName, appLabel = label(c.packageName), title = title, artist = artist, album = album,
            durationMs = dur, playing = playing, positionMs = ps?.position ?: 0L,
            positionAt = ps?.lastPositionUpdateTime ?: 0L, speed = ps?.playbackSpeed?.takeIf { it > 0f } ?: 1f,
            artVersion = artVersion, tint = tint, genre = SceneGuess.genre(title, album, artist), trackKey = key,
        )
        beats.playing = playing
        publish(t)
    }

    private fun setArt(bmp: Bitmap?, uri: String?) {
        val v = ++artVersion
        if (bmp == null && uri.isNullOrBlank()) { artBitmap = null; artJpeg = null; tint = null; return }
        io.execute {
            try {
                var b = bmp
                if (b == null && uri != null && (uri.startsWith("content:") || uri.startsWith("android.resource:") || uri.startsWith("file:"))) {
                    b = app.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it) }
                }
                if (b == null || b.isRecycled) return@execute
                val sc = 512f / maxOf(b.width, b.height)
                val small = if (sc < 1f) Bitmap.createScaledBitmap(b, (b.width * sc).toInt().coerceAtLeast(1), (b.height * sc).toInt().coerceAtLeast(1), true) else b.copy(Bitmap.Config.ARGB_8888, false)
                val tiny = Bitmap.createScaledBitmap(small, 48, 48, true)
                val px = IntArray(48 * 48); tiny.getPixels(px, 0, 48, 0, 0, 48, 48)
                val ti = CoverPalette.extract(px)
                val out = ByteArrayOutputStream(); small.compress(Bitmap.CompressFormat.JPEG, 88, out)
                main.post {
                    if (v != artVersion) return@post
                    artBitmap = small; artJpeg = out.toByteArray(); tint = ti
                    update()
                }
            } catch (t: Throwable) { Log.w(TAG, "art", t) }
        }
    }

    private fun publish(t: ExtTrack?) {
        current = t
        syncBeats()
        for (l in listeners) try { l(t) } catch (e: Throwable) { Log.w(TAG, "listener", e) }
    }

    // ---- transport (mirrors the outside player's own controls)
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
