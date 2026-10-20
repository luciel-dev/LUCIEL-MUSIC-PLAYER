package com.luciel.player

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import android.os.SystemClock
import android.util.Log

/**
 * Audio reactivity for *other* apps' audio (Spotify etc.).
 *  1. "live": android.media.audiofx.Visualizer on the global output mix (audio session 0). Needs RECORD_AUDIO; it only
 *     reads levels of what is already playing, nothing is recorded or stored. Some phones / Android versions hand out
 *     silence (or refuse) for session 0, so:
 *  2. "tap": the user tapped the tempo, or
 *  3. "tempo": a synthetic beat at the fallback BPM (default 120).
 */
class BeatEngine(private val ctx: Context) {
    data class Frame(
        val mags: IntArray, val wave: ByteArray, val sampleRate: Int, val bass: Float, val energy: Float, val vocal: Float, val high: Float,
        val bpm: Float, val beat: Double, val source: String, val playing: Boolean,
    )

    @Volatile private var viz: Visualizer? = null
    @Volatile private var liveMags = IntArray(512)
    @Volatile private var liveWave = ByteArray(512) { 0 }
    @Volatile private var lastLiveAt = 0L
    @Volatile private var silentSince = 0L
    @Volatile var vizState = "off"; private set      // off | live | silent | denied | unavailable
    private var sampleRate = 44100
    private val onset = OnsetTempo()
    private val tap = TapTempo()
    private var tapBpm = 0f
    private var tapT0 = 0L
    private var synthT0 = SystemClock.uptimeMillis()
    @Volatile private var bass = 0f; @Volatile private var energy = 0f; @Volatile private var vocal = 0f; @Volatile private var high = 0f
    var playing = false

    fun hasMicPermission() = ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    @Synchronized fun start() {
        if (viz != null) return
        if (!Prefs.get(ctx).useVisualizer) { vizState = "off"; return }
        if (!hasMicPermission()) { vizState = "denied"; return }
        try {
            val v = Visualizer(0)
            v.enabled = false
            val range = Visualizer.getCaptureSizeRange()
            v.captureSize = 1024.coerceIn(range[0], range[1])
            sampleRate = v.samplingRate / 1000
            v.setDataCaptureListener(object : Visualizer.OnDataCaptureListener {
                override fun onWaveFormDataCapture(vz: Visualizer?, waveform: ByteArray?, rate: Int) { if (waveform != null) liveWave = waveform.copyOf() }
                override fun onFftDataCapture(vz: Visualizer?, fft: ByteArray?, rate: Int) { if (fft != null) onFft(fft) }
            }, Visualizer.getMaxCaptureRate(), true, true)
            v.enabled = true
            viz = v; vizState = "live"
        } catch (t: Throwable) {
            Log.w("Luciel", "Visualizer(0) unavailable: ${t.message}")
            vizState = "unavailable"; viz = null
        }
    }

    @Synchronized fun stop() {
        try { viz?.enabled = false; viz?.release() } catch (_: Throwable) {}
        viz = null; if (vizState == "live" || vizState == "silent") vizState = "off"
    }

    private fun onFft(fft: ByteArray) {
        val now = SystemClock.uptimeMillis()
        val m = Spectrum.magnitudes(fft)
        val binHz = sampleRate / 2f / m.size
        if (Spectrum.isSilent(m)) {
            if (silentSince == 0L) silentSince = now
            if (now - silentSince > 2500) vizState = "silent"
            return
        }
        silentSince = 0L; vizState = "live"; lastLiveAt = now
        liveMags = m
        bass = Spectrum.band(m, binHz, 20f, 160f)
        energy = (Spectrum.band(m, binHz, 20f, 8000f) * 1.6f).coerceAtMost(1f)
        vocal = Spectrum.band(m, binHz, 300f, 3400f)
        high = Spectrum.band(m, binHz, 5000f, 10000f)
        onset.feed(bass, now)
    }

    /** new song: forget the measured / tapped tempo */
    fun trackChanged() { onset.reset(); tapBpm = 0f; synthT0 = SystemClock.uptimeMillis() }

    /** tap-tempo; returns the current tapped BPM */
    fun tap(): Float {
        val now = SystemClock.uptimeMillis()
        tap.tap(now)?.let { tapBpm = it; tapT0 = now }
        return tapBpm
    }
    fun setBpm(bpm: Float) { tapBpm = bpm.coerceIn(40f, 240f); tapT0 = SystemClock.uptimeMillis() }

    val isLive get() = vizState == "live" && SystemClock.uptimeMillis() - lastLiveAt < 1500

    fun clock(now: Long = SystemClock.uptimeMillis()): Pair<BeatClock, String> = when {
        tapBpm > 0f -> BeatClock(tapBpm, tapT0) to "tap"
        isLive && onset.bpm > 0f -> BeatClock(onset.bpm, onset.t0) to "live"
        else -> BeatClock(Prefs.get(ctx).fallbackBpm, synthT0) to "tempo"
    }

    private val synthMags = IntArray(512)
    private val synthWave = ByteArray(512)

    fun frame(): Frame {
        val now = SystemClock.uptimeMillis()
        val (clk, src) = clock(now)
        val beat = clk.beatAt(now)
        if (isLive) {
            return Frame(liveMags, liveWave, sampleRate, bass, energy, vocal, high, clk.bpm, beat, src, playing)
        }
        // synthetic: shaped noise driven by the beat grid (only while the outside player is playing)
        if (playing) Spectrum.synthetic(beat, now / 1000.0, synthMags) else synthMags.fill(0)
        val p = if (playing) clk.pulse(now) else 0f
        for (i in synthWave.indices) synthWave[i] = (128 + (if (playing) (Math.sin(i * 0.19 + now / 90.0) * 40 * (0.3 + p)) else 0.0)).toInt().toByte()
        val binHz = 44100 / 2f / synthMags.size
        return Frame(synthMags, synthWave, 44100, if (playing) Spectrum.band(synthMags, binHz, 20f, 160f) else 0f,
            if (playing) 0.45f + 0.3f * p else 0f, if (playing) 0.25f else 0f, if (playing) 0.15f + 0.2f * p else 0f, clk.bpm, beat, src, playing)
    }
}
