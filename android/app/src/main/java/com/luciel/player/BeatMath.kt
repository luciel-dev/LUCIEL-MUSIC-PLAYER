package com.luciel.player

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Tap-tempo: average of the recent tap intervals; a pause > 2 s starts over. */
class TapTempo(private val maxTaps: Int = 8) {
    private val taps = ArrayDeque<Long>()
    /** @return the new BPM once there are at least 2 taps, else null */
    fun tap(nowMs: Long): Float? {
        if (taps.isNotEmpty() && nowMs - taps.last() > 2000) taps.clear()
        taps.addLast(nowMs); while (taps.size > maxTaps) taps.removeFirst()
        if (taps.size < 2) return null
        val span = (taps.last() - taps.first()).toFloat() / (taps.size - 1)
        if (span <= 0f) return null
        return (60000f / span).coerceIn(40f, 240f)
    }
    val count get() = taps.size
}

/** A steady beat grid: bpm + the time of one beat. Phase is in beats (float). */
data class BeatClock(val bpm: Float, val t0Ms: Long) {
    fun beatAt(nowMs: Long): Double = if (bpm <= 0f) 0.0 else (nowMs - t0Ms) / (60000.0 / bpm)
    /** 1 right on the beat, decaying to ~0 before the next one */
    fun pulse(nowMs: Long): Float { val b = beatAt(nowMs); val f = b - floor(b); return exp(-f * 5.0).toFloat() }
}

/**
 * Live tempo from onsets of the bass envelope (e.g. Visualizer FFT at ~20 Hz).
 * Robust to the coarse sampling: median interval, then the mean of the intervals near the median, folded into 70..180 BPM.
 */
class OnsetTempo {
    private var avg = 0f
    private var lastOnset = -1L
    private val onsets = ArrayDeque<Long>()
    var bpm = 0f; private set
    var t0 = 0L; private set
    var confidence = 0f; private set

    /** feed a bass level 0..1 at time t (ms); returns true on an onset */
    fun feed(e: Float, t: Long): Boolean {
        avg = avg * 0.92f + e * 0.08f
        val onset = e > avg * 1.35f + 0.03f && (lastOnset < 0 || t - lastOnset > 200)
        if (!onset) return false
        lastOnset = t
        onsets.addLast(t); while (onsets.size > 24) onsets.removeFirst()
        if (onsets.size >= 6) estimate(t)
        return true
    }

    private fun estimate(t: Long) {
        val iv = onsets.zipWithNext { a, b -> (b - a).toFloat() }.map { fold(it) }.sorted()
        if (iv.isEmpty()) return
        val med = iv[iv.size / 2]
        val near = iv.filter { abs(it - med) < med * 0.16f }
        val p = near.average().toFloat()
        val newBpm = (600000f / p).roundToInt() / 10f
        confidence = near.size.toFloat() / iv.size
        bpm = if (bpm == 0f || abs(newBpm - bpm) > 8f) newBpm else bpm * 0.7f + newBpm * 0.3f
        t0 = t
    }

    fun reset() { avg = 0f; lastOnset = -1; onsets.clear(); bpm = 0f; confidence = 0f }

    companion object {
        /** fold an interval (ms) into 333..857 ms (70..180 BPM) */
        fun fold(ms: Float): Float { var p = ms; if (p <= 0f) return 500f; while (p < 333f) p *= 2f; while (p > 857f) p /= 2f; return p }
    }
}

/** Turns android.media.audiofx.Visualizer FFT bytes into Web-Audio-like 0..255 magnitudes and band levels. */
object Spectrum {
    /**
     * Visualizer.getFft layout: [0]=DC real, [1]=Nyquist real, then (re, im) pairs for bins 1..n/2-1.
     * @return n/2 magnitudes scaled to 0..255 roughly like AnalyserNode.getByteFrequencyData (-92..-18 dB window)
     */
    fun magnitudes(fft: ByteArray, out: IntArray = IntArray(fft.size / 2)): IntArray {
        val n = fft.size / 2
        for (k in 0 until n) {
            val m = when (k) {
                0 -> abs(fft[0].toFloat())
                else -> hypot(fft[2 * k].toFloat(), fft[2 * k + 1].toFloat())
            }
            // 8-bit FFT: |X| up to ~181; map 20*log10 to 0..255 with a soft floor
            val db = if (m <= 0.0001f) -100f else (20f * log10(m / 128f))   // ~ -42 .. +3 dB
            out[k] = (((db + 42f) / 42f) * 255f).roundToInt().coerceIn(0, 255)
        }
        return out
    }

    /** mean level 0..1 of bins between f0 and f1 Hz (binHz = sampleRate / (2 * bins)) */
    fun band(mags: IntArray, binHz: Float, f0: Float, f1: Float): Float {
        val a = max(1, (f0 / binHz).toInt()); val b = min(mags.size, max(a + 1, (f1 / binHz).toInt()))
        var s = 0; for (i in a until b) s += mags[i]
        return s / ((b - a) * 255f)
    }

    /** true when the "audio" is digital silence (e.g. Visualizer blocked by the device / DRM) */
    fun isSilent(mags: IntArray): Boolean = mags.all { it < 8 }

    /**
     * A believable fake spectrum for the synthetic beat: kick in the lows on every beat, snare/hat in the mids/highs on
     * the off-beats, plus a slow shimmer so bars never freeze.
     */
    fun synthetic(beat: Double, timeSec: Double, out: IntArray): IntArray {
        val f = beat - floor(beat)
        val kick = exp(-f * 7.0)
        val half = beat * 2; val fh = half - floor(half)
        val hat = exp(-fh * 10.0) * 0.6
        val n = out.size
        for (k in 0 until n) {
            val x = k.toDouble() / n                                  // 0..1 of the spectrum
            val shape = 0.55 * exp(-x * 9.0) + 0.25 * exp(-abs(x - 0.18) * 14.0) + 0.08
            val lowBoost = if (x < 0.04) kick * 0.9 else kick * 0.25 * exp(-x * 12.0)
            val midHat = if (x in 0.12..0.6) hat * 0.35 * (1 - x) else 0.0
            val wobble = 0.06 * sin(timeSec * 2.3 + k * 0.37) + 0.04 * sin(timeSec * 5.1 + k * 1.3)
            out[k] = ((shape + lowBoost + midHat + wobble) * 255).roundToInt().coerceIn(0, 255)
        }
        return out
    }

    @Suppress("unused") private fun ln2(x: Double) = ln(x) / ln(2.0)
}
