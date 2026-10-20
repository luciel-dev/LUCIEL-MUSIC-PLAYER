package com.luciel.player

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/** What the WebView's <audio> element is doing (pushed from js via WebBridge.reportState). */
data class WebState(
    val id: String = "", val title: String = "", val artist: String = "", val album: String = "",
    val durationMs: Long = C.TIME_UNSET, val positionMs: Long = 0, val playing: Boolean = false, val hasTrack: Boolean = false,
    val hasPrev: Boolean = true, val hasNext: Boolean = true, val artUri: Uri? = null, val artData: ByteArray? = null,
    /** between two songs: still "playing" for Android (keeps the foreground service), shown as buffering */
    val buffering: Boolean = false,
    /** tempo + beat phase at positionMs, so the floater can dance in sync without the page's analyser */
    val bpm: Float = 0f, val beatPos: Double = 0.0,
    val theme: FloaterTheme = FloaterTheme(), val sceneId: String = "", val sceneArt: ByteArray? = null, val mascotOn: Boolean = true,
    val reportedAt: Long = android.os.SystemClock.elapsedRealtime(),
) {
    fun positionNow(now: Long = android.os.SystemClock.elapsedRealtime()): Long =
        if (!playing || buffering) positionMs else (positionMs + (now - reportedAt)).let { if (durationMs > 0) it.coerceAtMost(durationMs) else it }
    /** beats since the start of the song, extrapolated from the last report */
    fun beatNow(now: Long = android.os.SystemClock.elapsedRealtime()): Double =
        if (bpm <= 0f) 0.0 else beatPos + (if (playing && !buffering) (now - reportedAt) / 1000.0 * bpm / 60.0 else 0.0)
}

/** palette + skin of the page, for the floater (all colours as parsed ARGB ints) */
data class FloaterTheme(
    val skin: String = "aero", val palette: String = "aero",
    val accent: Int = 0xFF1E94EE.toInt(), val accent2: Int = 0xFF74CCFF.toInt(), val bg: Int = 0xFF1B2A3A.toInt(), val bg3: Int = 0xFF0B1622.toInt(), val text: Int = 0xFFFFFFFF.toInt(),
    val lcdBg: Int = 0xFF07162A.toInt(), val lcdFg: Int = 0xFF94DCFF.toInt(), val frame1: Int = 0xFFE6ECF2.toInt(), val frame2: Int = 0xFFB9C6D3.toInt(), val frame3: Int = 0xFF8797A9.toInt(), val frameDark: Int = 0xFF46556A.toInt(),
) { val classic get() = skin == "classic" }

/**
 * The music itself is decoded by the WebView (so Luciel's 10-band EQ, analyser, BPM detection and visuals keep working).
 * This player is a thin Media3 front for it: it publishes the WebView's state to a MediaSession – notification, lock
 * screen, Bluetooth / headset / car buttons, Quick Settings media – and forwards their commands back to the page.
 */
@UnstableApi
class WebPlayer(looper: Looper, private val onCommand: (String, Long) -> Unit) : SimpleBasePlayer(looper) {
    var web = WebState()
        set(v) { field = v; positionAt = android.os.SystemClock.elapsedRealtime(); invalidateState() }
    private var positionAt = 0L

    private val commands = Player.Commands.Builder().addAll(
        COMMAND_PLAY_PAUSE, COMMAND_STOP, COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, COMMAND_SEEK_TO_PREVIOUS,
        COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, COMMAND_SEEK_TO_MEDIA_ITEM, COMMAND_GET_CURRENT_MEDIA_ITEM,
        COMMAND_GET_TIMELINE, COMMAND_GET_METADATA, COMMAND_GET_AUDIO_ATTRIBUTES,
    ).build()

    override fun getState(): State {
        val w = web
        val b = State.Builder().setAvailableCommands(commands)
            .setAudioAttributes(androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build())
        if (!w.hasTrack) return b.setPlaybackState(STATE_IDLE).setPlayWhenReady(false, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST).build()
        val md = MediaMetadata.Builder().setTitle(w.title).setArtist(w.artist).setAlbumTitle(w.album.ifBlank { null })
            .setDisplayTitle(w.title).setIsPlayable(true).setIsBrowsable(false)
        if (w.artData != null) md.setArtworkData(w.artData, MediaMetadata.PICTURE_TYPE_FRONT_COVER) else if (w.artUri != null) md.setArtworkUri(w.artUri)
        val cur = MediaItemData.Builder("cur:" + w.id).setMediaItem(MediaItem.Builder().setMediaId(w.id).setMediaMetadata(md.build()).build())
            .setMediaMetadata(md.build()).setDurationUs(if (w.durationMs > 0) w.durationMs * 1000 else C.TIME_UNSET).setIsSeekable(w.durationMs > 0).build()
        // neighbours make the system show previous / next buttons; selecting them just tells the page to skip
        val items = mutableListOf<MediaItemData>()
        if (w.hasPrev) items += MediaItemData.Builder("prev").setMediaItem(MediaItem.Builder().setMediaId("prev").build()).build()
        items += cur
        if (w.hasNext) items += MediaItemData.Builder("next").setMediaItem(MediaItem.Builder().setMediaId("next").build()).build()
        val pos = w.positionMs + if (w.playing && !w.buffering) android.os.SystemClock.elapsedRealtime() - positionAt else 0
        return b.setPlaylist(items).setCurrentMediaItemIndex(if (w.hasPrev) 1 else 0)
            .setContentPositionMs(pos.coerceAtLeast(0))
            .setPlaybackState(if (w.playing && w.buffering) STATE_BUFFERING else STATE_READY)
            .setPlayWhenReady(w.playing, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> { onCommand(if (playWhenReady) "play" else "pause", 0); return Futures.immediateVoidFuture() }
    override fun handleStop(): ListenableFuture<*> { onCommand("pause", 0); return Futures.immediateVoidFuture() }
    override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()
    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val (cmd, arg) = SeekMap.command(seekCommand, mediaItemIndex, if (web.hasPrev) 1 else 0, positionMs)
        onCommand(cmd, arg)
        return Futures.immediateVoidFuture()
    }
}

@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    lateinit var player: WebPlayer; private set
    private lateinit var am: AudioManager
    private var focus: AudioFocusRequest? = null
    private val focusLogic = FocusLogic()
    private var noisyRegistered = false

    private val noisy = object : BroadcastReceiver() {
        // headphones unplugged / Bluetooth disconnected: pause right away (and don't auto-resume after a call)
        override fun onReceive(c: Context?, i: Intent?) { if (i?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) { focusLogic.onUserPause(); WebBridge.sendCommand("pause") } }
    }

    override fun onCreate() {
        super.onCreate()
        am = getSystemService(AudioManager::class.java)
        player = WebPlayer(Looper.getMainLooper()) { cmd, pos -> control(cmd, pos) }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, player).setSessionActivity(open).setId("luciel").build()
        instance = this
        WebBridge.lastState?.let { onWebState(it) }
    }

    /** session buttons, notification, floater -> page (audio-focus aware) */
    fun control(cmd: String, pos: Long = 0) {
        when (cmd) {
            // a play press during a phone call: Android refuses focus -> stay paused instead of playing over the call
            "play" -> if (requestFocus()) WebBridge.sendCommand(cmd, pos)
            "pause" -> { focusLogic.onUserPause(); WebBridge.sendCommand(cmd, pos) }
            "toggle" -> control(if (player.web.playing) "pause" else "play", pos)
            else -> WebBridge.sendCommand(cmd, pos)
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** called on the main thread whenever the page reports a change */
    fun onWebState(s: WebState) {
        val wasPlaying = player.web.playing
        player.web = s
        // started from the page itself (play button, auto-advance): ask for focus; refused (call in progress) -> pause again
        if (s.playing && !wasPlaying) { if (requestFocus()) registerNoisy(true) else WebBridge.sendCommand("pause") }
        if (!s.playing && wasPlaying) registerNoisy(false)
    }

    /** true when we hold (or just got) audio focus */
    private fun requestFocus(): Boolean {
        if (!focusLogic.needsRequest()) return true
        val req = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setWillPauseWhenDucked(false)          // let Android duck us (navigation prompts etc.)
            .setOnAudioFocusChangeListener { change ->
                focusLogic.onChange(change, player.web.playing).forEach { (c, a) -> WebBridge.sendCommand(c, a) }
            }.build().also { focus = it }
        return focusLogic.onRequest(am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
    }

    private fun registerNoisy(on: Boolean) {
        if (on && !noisyRegistered) { ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED); noisyRegistered = true }
        else if (!on && noisyRegistered) { try { unregisterReceiver(noisy) } catch (_: Throwable) {}; noisyRegistered = false }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // the WebView (and with it the music) lives in the activity; when the task is swiped away, stop cleanly
        WebBridge.sendCommand("pause")
        stopSelf()
    }

    override fun onDestroy() {
        registerNoisy(false)
        focus?.let { am.abandonAudioFocusRequest(it) }
        session?.run { player.release(); release() }
        session = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object { @Volatile var instance: PlaybackService? = null }
}
