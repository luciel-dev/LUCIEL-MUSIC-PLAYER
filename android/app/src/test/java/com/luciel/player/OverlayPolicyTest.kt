package com.luciel.player

import com.luciel.player.OverlayPolicy.Show
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class OverlayPolicyTest {
    private fun inp(
        canDraw: Boolean = true, appInFront: Boolean = false, ownHasTrack: Boolean = true, ownPlaying: Boolean = false,
        poppedOut: Boolean = false, autoFloater: Boolean = false, ownShowing: Boolean = false, ownDismissed: Boolean = false,
        extWanted: Boolean = false, extPlaying: Boolean = false,
    ) = OverlayPolicy.Input(canDraw, appInFront, ownHasTrack, ownPlaying, poppedOut, autoFloater, ownShowing, ownDismissed, extWanted, extPlaying)

    @Test fun nothingWithoutPermission() {
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(canDraw = false, ownPlaying = true, poppedOut = true, extWanted = true, extPlaying = true)))
    }
    @Test fun nothingWhileAppInFront() {
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(appInFront = true, ownPlaying = true, poppedOut = true)))
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(appInFront = true, extWanted = true, extPlaying = true)))
    }
    @Test fun popOutShowsOwn() {
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(poppedOut = true)))
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(poppedOut = true, ownPlaying = true)))
    }
    @Test fun autoFloaterOnlyWhilePlayingOrAlreadyUp() {
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(autoFloater = true, ownPlaying = true)))
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(autoFloater = true, ownPlaying = false)))
        // pausing from the floater must not make it vanish
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(autoFloater = true, ownPlaying = false, ownShowing = true)))
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(autoFloater = false, ownPlaying = true)))
    }
    @Test fun ownPlaybackBeatsSpotify() {
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(poppedOut = true, ownPlaying = true, extWanted = true, extPlaying = true)))
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(autoFloater = true, ownPlaying = true, extWanted = true, extPlaying = true)))
    }
    @Test fun spotifyPlayingBeatsPausedLuciel() {
        assertEquals(Show.EXT, OverlayPolicy.decide(inp(poppedOut = true, ownPlaying = false, extWanted = true, extPlaying = true)))
        assertEquals(Show.EXT, OverlayPolicy.decide(inp(extWanted = true, extPlaying = true)))
    }
    @Test fun pausedBothPrefersPoppedOutOwn() {
        assertEquals(Show.OWN, OverlayPolicy.decide(inp(poppedOut = true, extWanted = true, extPlaying = false)))
        assertEquals(Show.EXT, OverlayPolicy.decide(inp(extWanted = true, extPlaying = false)))
    }
    @Test fun dismissedAndNoTrack() {
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(poppedOut = true, ownPlaying = true, ownDismissed = true)))
        assertEquals(Show.EXT, OverlayPolicy.decide(inp(poppedOut = true, ownDismissed = true, extWanted = true, extPlaying = true)))
        assertEquals(Show.NONE, OverlayPolicy.decide(inp(ownHasTrack = false, poppedOut = true)))
        assertFalse(OverlayPolicy.ownCandidate(inp(ownHasTrack = false, poppedOut = true)))
    }
}
