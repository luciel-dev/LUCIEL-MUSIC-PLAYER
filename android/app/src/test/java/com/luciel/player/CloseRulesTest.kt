package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.1.2: ✕ closes for good, Pop out is one-shot, nothing auto-reappears, closing never touches playback. */
class CloseRulesTest {
    private val base = CloseRules.Floater()
    private fun inp(st: CloseRules.Floater, playing: Boolean = true, appInFront: Boolean = false, auto: Boolean = false, showing: Boolean = false) =
        OverlayPolicy.Input(canDraw = true, appInFront = appInFront, ownHasTrack = true, ownPlaying = playing, poppedOut = st.poppedOut,
            autoFloater = auto, ownShowing = showing, ownDismissed = st.dismissed, extWanted = false, extPlaying = false)

    @Test fun closeStaysClosedAcrossNewSongsAndPlays() {
        var s = CloseRules.close(CloseRules.popOut(base))
        assertEquals(OverlayPolicy.Show.NONE, OverlayPolicy.decide(inp(s)))
        s = CloseRules.playStarted(s)                       // next song / play again
        assertTrue(s.closed); assertEquals(OverlayPolicy.Show.NONE, OverlayPolicy.decide(inp(s, auto = true)))
    }
    @Test fun popOutReopensAfterClose() {
        val s = CloseRules.popOut(CloseRules.close(base))
        assertFalse(s.closed); assertEquals(OverlayPolicy.Show.OWN, OverlayPolicy.decide(inp(s)))
    }
    @Test fun popOutIsOneShot_noReappearOnEveryLeave() {
        var s = CloseRules.popOut(base)
        assertEquals(OverlayPolicy.Show.OWN, OverlayPolicy.decide(inp(s)))
        s = CloseRules.appFront(s)                          // user came back to Luciel
        assertEquals(OverlayPolicy.Show.NONE, OverlayPolicy.decide(inp(s, appInFront = true)))
        assertEquals(OverlayPolicy.Show.NONE, OverlayPolicy.decide(inp(s)))   // leaves again: no surprise floater
    }
    @Test fun autoShowOnlyWithTheExplicitSetting() {
        assertEquals(OverlayPolicy.Show.NONE, OverlayPolicy.decide(inp(base, auto = false)))
        assertEquals(OverlayPolicy.Show.OWN, OverlayPolicy.decide(inp(base, auto = true)))
    }
    @Test fun turningAutoOnAgainClearsTheClose() {
        val s = CloseRules.autoSettingOn(CloseRules.close(base))
        assertEquals(OverlayPolicy.Show.OWN, OverlayPolicy.decide(inp(s, auto = true)))
    }
    @Test fun autoHideAfterLongPauseComesBackOnPlayButCloseDoesNot() {
        var s = CloseRules.pausedLong(base); assertTrue(s.dismissed); s = CloseRules.playStarted(s); assertFalse(s.dismissed)
        var c = CloseRules.pausedLong(CloseRules.popOut(base)); assertFalse("popped-out floater isn't auto-hidden", c.dismissed)
        c = CloseRules.playStarted(CloseRules.close(c)); assertTrue(c.dismissed)
    }
    @Test fun closingNeverStopsMusic() {
        assertTrue(CloseRules.playbackCommandsOnClose.isEmpty())
        assertFalse(CloseRules.cardEnabledAfterClose())
    }
    @Test fun spotifyCardDefaultsOff() {
        val src = listOf(java.io.File("src/main/java/com/luciel/player/Prefs.kt"), java.io.File("app/src/main/java/com/luciel/player/Prefs.kt")).first { it.exists() }.readText()
        assertTrue(src.contains("getBoolean(\"overlay\", false)"))
        assertTrue(src.contains("getBoolean(\"autoFloater\", false)"))
    }
    @Test fun closeActionsDontSendPlaybackCommands() {
        val dir = listOf(java.io.File("src/main/java/com/luciel/player"), java.io.File("app/src/main/java/com/luciel/player")).first { it.exists() }
        fun body(file: String, fn: String): String { val t = java.io.File(dir, file).readText(); val i = t.indexOf("fun $fn("); return t.substring(i, t.indexOf("\n    }", i)) }
        for ((f, fn) in listOf("FloaterController.kt" to "close", "OverlayController.kt" to "closeFully", "PlaybackService.kt" to "closeOverlays")) {
            val b = body(f, fn)
            assertFalse("$f.$fn sends a command", Regex("sendCommand|control\\(|playPause|\\.pause\\(|transportControls").containsMatchIn(b))
        }
    }
}
