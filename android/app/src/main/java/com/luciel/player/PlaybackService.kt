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
)

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
        val pos = w.positionMs + if (w.playing) android.os.SystemClock.elapsedRealtime() - positionAt else 0
        return b.setPlaylist(items).setCurrentMediaItemIndex(if (w.hasPrev) 1 else 0)
            .setContentPositionMs(pos.coerceAtLeast(0))
            .setPlaybackState(STATE_READY)
            .setPlayWhenReady(w.playing, PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> { onCommand(if (playWhenReady) "play" else "pause", 0); return Futures.immediateVoidFuture() }
    override fun handleStop(): ListenableFuture<*> { onCommand("pause", 0); return Futures.immediateVoidFuture() }
    override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()
    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        val curIdx = if (web.hasPrev) 1 else 0
        when (seekCommand) {
            COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> onCommand("next", 0)
            COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> if (mediaItemIndex == curIdx) onCommand("seek", 0) else onCommand("prev", 0)
            COMMAND_SEEK_TO_MEDIA_ITEM -> when { mediaItemIndex > curIdx -> onCommand("next", 0); mediaItemIndex < curIdx -> onCommand("prev", 0); else -> onCommand("seek", positionMs.coerceAtLeast(0)) }
            else -> onCommand("seek", positionMs.coerceAtLeast(0))
        }
        return Futures.immediateVoidFuture()
    }
}

@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    lateinit var player: WebPlayer; private set
    private lateinit var am: AudioManager
    private var focus: AudioFocusRequest? = null
    private var hasFocus = false
    private var resumeOnGain = false
    private var noisyRegistered = false

    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) { if (i?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) WebBridge.sendCommand("pause") }
    }

    override fun onCreate() {
        super.onCreate()
        am = getSystemService(AudioManager::class.java)
        player = WebPlayer(Looper.getMainLooper()) { cmd, pos ->
            if (cmd == "play") requestFocus()
            WebBridge.sendCommand(cmd, pos)
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, player).setSessionActivity(open).setId("luciel").build()
        instance = this
        WebBridge.lastState?.let { onWebState(it) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** called on the main thread whenever the page reports a change */
    fun onWebState(s: WebState) {
        val wasPlaying = player.web.playing
        player.web = s
        if (s.playing && !wasPlaying) { requestFocus(); registerNoisy(true) }
        if (!s.playing && wasPlaying) registerNoisy(false)
    }

    private fun requestFocus() {
        if (hasFocus) return
        val req = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setWillPauseWhenDucked(false)          // let Android duck us (navigation prompts etc.)
            .setOnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS -> { hasFocus = false; resumeOnGain = false; WebBridge.sendCommand("pause") }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { resumeOnGain = player.web.playing; WebBridge.sendCommand("pause") }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> WebBridge.sendCommand("duck", 1)
                    AudioManager.AUDIOFOCUS_GAIN -> { hasFocus = true; WebBridge.sendCommand("duck", 0); if (resumeOnGain) { resumeOnGain = false; WebBridge.sendCommand("play") } }
                }
            }.build().also { focus = it }
        hasFocus = am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
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
