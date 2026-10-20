package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionPickerTest {
    private val own = "com.luciel.player"
    private val yt = "com.google.android.apps.youtube.music"

    @Test fun neverPicksOwnApp() {
        assertNull(SessionPicker.pick(listOf(SessionInfo(own, true), SessionInfo("$own.debug", true)), own, false, null))
    }

    @Test fun spotifyWinsAmongPlaying() {
        val s = listOf(SessionInfo(yt, true, order = 0), SessionInfo(Prefs.SPOTIFY, true, order = 1))
        assertEquals(Prefs.SPOTIFY, SessionPicker.pick(s, own, false, null)?.pkg)
    }

    @Test fun playingBeatsPaused() {
        val s = listOf(SessionInfo(Prefs.SPOTIFY, false, order = 0), SessionInfo(yt, true, order = 1))
        assertEquals(yt, SessionPicker.pick(s, own, false, null)?.pkg)
    }

    @Test fun spotifyOnlyFilters() {
        val s = listOf(SessionInfo(yt, true), SessionInfo(Prefs.SPOTIFY, false, order = 1))
        assertEquals(Prefs.SPOTIFY, SessionPicker.pick(s, own, true, null)?.pkg)
        assertNull(SessionPicker.pick(listOf(SessionInfo(yt, true)), own, true, null))
    }

    @Test fun keepsFollowingLastWhenNothingPlays() {
        val s = listOf(SessionInfo("a.b", false, order = 0), SessionInfo(yt, false, order = 1))
        assertEquals(yt, SessionPicker.pick(s, own, false, yt)?.pkg)
        assertEquals("a.b", SessionPicker.pick(s, own, false, null)?.pkg)
    }

    @Test fun lastFollowedPreferredOverSystemOrderWhenPlaying() {
        val s = listOf(SessionInfo("a.b", true, order = 0), SessionInfo(yt, true, order = 1))
        assertEquals(yt, SessionPicker.pick(s, own, false, yt)?.pkg)
        assertEquals("a.b", SessionPicker.pick(s, own, false, null)?.pkg)
    }

    @Test fun prefersSessionsWithMetadata() {
        val s = listOf(SessionInfo("a.b", true, hasMetadata = false, order = 0), SessionInfo(yt, true, order = 1))
        assertEquals(yt, SessionPicker.pick(s, own, false, null)?.pkg)
    }
}
