package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 1.1.1 regression guards for "the music pauses and stops within a second":
 * the WebView owns audio focus for its <audio>; if PlaybackService also requests focus, Android hands focus back and
 * forth between them and the WebView pauses itself. These checks keep the service from ever asking for focus again.
 */
class AudioPlaybackRulesTest {
    private fun src(name: String): String {
        val f = listOf(File("src/main/java/com/luciel/player/$name"), File("app/src/main/java/com/luciel/player/$name")).first { it.exists() }
        return f.readText().lines().filterNot { it.trim().startsWith("*") || it.trim().startsWith("//") || it.trim().startsWith("/**") }.joinToString("\n")
    }

    @Test fun playbackServiceNeverRequestsAudioFocus() {
        val s = src("PlaybackService.kt")
        assertFalse("PlaybackService must not request audio focus (the WebView does)", s.contains("requestAudioFocus"))
        assertFalse(s.contains("AudioFocusRequest"))
        assertFalse(s.contains("AUDIOFOCUS_GAIN"))
    }

    @Test fun nothingElseInTheAppRequestsAudioFocus() {
        val dir = listOf(File("src/main/java/com/luciel/player"), File("app/src/main/java/com/luciel/player")).first { it.exists() }
        val offenders = dir.listFiles()!!.filter { it.extension == "kt" && src(it.name).contains("requestAudioFocus") }.map { it.name }
        assertTrue("files requesting audio focus: $offenders", offenders.isEmpty())
    }

    @Test fun pausesFromTheServiceAreLogged() {
        val s = src("PlaybackService.kt")
        assertTrue(s.contains("DebugLog.add"))
    }

    @Test fun wavHeaderForDecodedCopies() {
        val h = AudioDecoder.header(dataBytes = 176_400L * 35, rate = 44_100, channels = 2)
        assertEquals(44, h.size)
        val b = ByteBuffer.wrap(h).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(h, 0, 4)); assertEquals("WAVE", String(h, 8, 4)); assertEquals("fmt ", String(h, 12, 4)); assertEquals("data", String(h, 36, 4))
        assertEquals(36 + 176_400 * 35, b.getInt(4))
        assertEquals(1, b.getShort(20).toInt())        // PCM
        assertEquals(2, b.getShort(22).toInt())        // channels
        assertEquals(44_100, b.getInt(24))
        assertEquals(176_400, b.getInt(28))            // byte rate
        assertEquals(4, b.getShort(32).toInt())        // block align
        assertEquals(16, b.getShort(34).toInt())       // bits
        assertEquals(176_400 * 35, b.getInt(40))
    }

    @Test fun wavHeaderMono() {
        val b = ByteBuffer.wrap(AudioDecoder.header(1000, 22_050, 1)).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(1, b.getShort(22).toInt()); assertEquals(44_100, b.getInt(28)); assertEquals(2, b.getShort(32).toInt())
    }
}
