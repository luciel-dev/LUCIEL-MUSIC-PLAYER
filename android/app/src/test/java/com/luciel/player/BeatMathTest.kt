package com.luciel.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

class BeatMathTest {
    @Test fun tapTempo() {
        val t = TapTempo()
        assertNull(t.tap(0))
        assertEquals(120f, t.tap(500)!!, 0.01f)
        assertEquals(120f, t.tap(1000)!!, 0.01f)
        assertEquals(120f, t.tap(1500)!!, 0.01f)
        // a pause over 2 s starts over
        assertNull(t.tap(5000)); assertEquals(1, t.count)
        assertEquals(100f, t.tap(5600)!!, 0.01f)
    }

    @Test fun tapTempoClamped() {
        val t = TapTempo(); t.tap(0); assertEquals(240f, t.tap(50)!!, 0.01f)
    }

    @Test fun beatClock() {
        val c = BeatClock(120f, 1000)
        assertEquals(0.0, c.beatAt(1000), 1e-9)
        assertEquals(2.0, c.beatAt(2000), 1e-9)
        assertEquals(1f, c.pulse(1500), 1e-4f)
        assertTrue(c.pulse(1900) < 0.1f)
        assertEquals(0.0, BeatClock(0f, 0).beatAt(5000), 1e-9)
    }

    private fun runOnsets(bpm: Double, jitterMs: Int = 0, seconds: Int = 20): OnsetTempo {
        val o = OnsetTempo(); val period = 60000.0 / bpm; val rnd = java.util.Random(7)
        var t = 0L
        while (t < seconds * 1000L) {          // ~20 Hz sampling like the Visualizer
            val sinceBeat = (t % period.toLong().coerceAtLeast(1))
            val e = if (sinceBeat < 60) 0.9f else 0.1f
            o.feed(e, t + (if (jitterMs > 0) rnd.nextInt(jitterMs) else 0)); t += 50
        }
        return o
    }

    @Test fun onsetTempoFindsSteadyBeat() {
        assertEquals(120f, runOnsets(120.0).bpm, 4f)
        assertEquals(100f, runOnsets(100.0).bpm, 5f)
    }

    @Test fun onsetTempoFoldsIntoDanceRange() {
        // 60 BPM kicks fold to 120, 200 BPM to 100
        assertEquals(120f, runOnsets(60.0, seconds = 30).bpm, 5f)
        val b = runOnsets(200.0).bpm
        assertTrue("bpm $b", b in 70f..180f)
    }

    @Test fun foldInterval() {
        assertEquals(500f, OnsetTempo.fold(250f), 0.01f)
        assertEquals(500f, OnsetTempo.fold(1000f), 0.01f)
        assertEquals(400f, OnsetTempo.fold(400f), 0.01f)
        assertEquals(500f, OnsetTempo.fold(0f), 0.01f)
    }

    @Test fun spectrumMagnitudes() {
        // 1024-byte Visualizer FFT with energy in bin 4 only
        val fft = ByteArray(1024); fft[8] = 127; fft[9] = 0
        val m = Spectrum.magnitudes(fft)
        assertEquals(512, m.size)
        assertTrue(m[4] > 240); assertEquals(0, m[3]); assertEquals(0, m[100])
        assertTrue(Spectrum.isSilent(Spectrum.magnitudes(ByteArray(1024))))
        assertFalse(Spectrum.isSilent(m))
    }

    @Test fun spectrumBand() {
        val m = IntArray(512); for (i in 1..5) m[i] = 255
        val binHz = 44100f / 1024f
        assertEquals(1f, Spectrum.band(m, binHz, binHz, binHz * 6), 1e-4f)
        assertEquals(0f, Spectrum.band(m, binHz, 2000f, 4000f), 1e-4f)
    }

    @Test fun syntheticSpectrumPulsesOnTheBeat() {
        val on = Spectrum.synthetic(4.0, 1.0, IntArray(128)); val off = Spectrum.synthetic(4.6, 1.0, IntArray(128))
        assertTrue("kick louder on the beat", on.take(4).sum() > off.take(4).sum())
        assertTrue(on.all { it in 0..255 }); assertFalse(Spectrum.isSilent(off))
    }

    @Test fun realSineMapsToItsBin() {
        // build a fake 8-bit FFT of a pure tone: re/im pairs, bin 20 strong
        val fft = ByteArray(1024)
        fft[40] = (100 * cos(PI / 4)).roundToInt().toByte(); fft[41] = (100 * sin(PI / 4)).roundToInt().toByte()
        val m = Spectrum.magnitudes(fft)
        assertEquals(20, m.indices.maxByOrNull { m[it] })
        assertArrayEquals(IntArray(10), m.copyOfRange(100, 110))
    }
}
