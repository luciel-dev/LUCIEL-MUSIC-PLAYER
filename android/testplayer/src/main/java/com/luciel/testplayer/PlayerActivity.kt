package com.luciel.testplayer

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.widget.TextView
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/** Stand-in music app for emulator tests: MediaSession with metadata + cover, and a synthesized 128 BPM beat. */
class PlayerActivity : Activity() {
    private lateinit var session: MediaSession
    private var playing = false
    private var track = 0
    private var posMs = 42_000L
    private var posAt = SystemClock.elapsedRealtime()
    @Volatile private var run = true
    private lateinit var label: TextView
    private val tracks = listOf(
        arrayOf("Midnight City Drive", "Neon Arcade", "Retrowave Nights", "#ff3fa4", "#2a0b45", "128"),
        arrayOf("Forest Rave", "Slime Collective", "Green Room", "#3fe07a", "#06281a", "140"),
    )

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        label = TextView(this).apply { textSize = 22f; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setBackgroundColor(Color.rgb(20, 20, 30)) }
        setContentView(label)
        session = MediaSession(this, "testplayer").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = setPlaying(true)
                override fun onPause() = setPlaying(false)
                override fun onSkipToNext() { track = (track + 1) % tracks.size; posMs = 0; posAt = SystemClock.elapsedRealtime(); publishMeta(); setPlaying(true) }
                override fun onSkipToPrevious() { track = (track + tracks.size - 1) % tracks.size; posMs = 0; posAt = SystemClock.elapsedRealtime(); publishMeta(); setPlaying(true) }
                override fun onSeekTo(pos: Long) { posMs = pos; posAt = SystemClock.elapsedRealtime(); publishState() }
            })
            isActive = true
        }
        publishMeta(); setPlaying(true)
        thread(name = "beat") { synth() }
    }

    private fun cover(c1: Int, c2: Int): Bitmap {
        val bm = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888); val c = Canvas(bm); val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 0f, 512f, c2, Color.BLACK, Shader.TileMode.CLAMP); c.drawRect(0f, 0f, 512f, 512f, p)
        p.shader = LinearGradient(0f, 120f, 0f, 380f, Color.rgb(255, 200, 60), c1, Shader.TileMode.CLAMP); c.drawCircle(256f, 250f, 130f, p)
        p.shader = null; p.color = c2; for (i in 0 until 6) c.drawRect(100f, 270f + i * 20f, 412f, 278f + i * 20f, p)
        p.color = c1; p.strokeWidth = 3f; for (i in 0..8) c.drawLine(0f, 400f + i * i * 2f, 512f, 400f + i * i * 2f, p)
        return bm
    }

    private fun publishMeta() {
        val t = tracks[track]
        session.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, t[0]).putString(MediaMetadata.METADATA_KEY_ARTIST, t[1])
            .putString(MediaMetadata.METADATA_KEY_ALBUM, t[2]).putLong(MediaMetadata.METADATA_KEY_DURATION, 241_000)
            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover(Color.parseColor(t[3]), Color.parseColor(t[4]))).build())
        runOnUiThread { label.text = "${t[0]}\n${t[1]}\n(test player)" }
    }

    private fun pos() = if (playing) posMs + (SystemClock.elapsedRealtime() - posAt) else posMs

    private fun setPlaying(p: Boolean) { posMs = pos(); posAt = SystemClock.elapsedRealtime(); playing = p; publishState() }

    private fun publishState() {
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, pos(), if (playing) 1f else 0f, SystemClock.elapsedRealtime()).build())
    }

    /** kick on every beat, hat on the off-beat, a bass note; tempo from the current track */
    private fun synth() {
        val sr = 44100
        val min = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val at = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(sr).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(min * 2).setTransferMode(AudioTrack.MODE_STREAM).build()
        at.play()
        val buf = ShortArray(1024); var n = 0L; val rnd = java.util.Random(1)
        while (run) {
            val bpm = tracks[track][5].toDouble(); val spb = sr * 60.0 / bpm
            for (i in buf.indices) {
                if (!playing) { buf[i] = 0; continue }
                val t = n++; val ph = (t % spb.toLong()) / sr.toDouble(); val half = ((t + (spb / 2).toLong()) % spb.toLong()) / sr.toDouble()
                val kick = sin(2 * PI * (50 + 90 * exp(-ph * 30)) * ph) * exp(-ph * 9)
                val hat = (rnd.nextDouble() * 2 - 1) * exp(-half * 60) * 0.25
                val bass = sin(2 * PI * 55.0 * t / sr) * 0.15
                buf[i] = ((kick * 0.7 + hat + bass) * 20000).toInt().coerceIn(-32767, 32767).toShort()
            }
            at.write(buf, 0, buf.size)
        }
        at.stop(); at.release()
    }

    override fun onDestroy() { run = false; session.release(); super.onDestroy() }
}
