package com.luciel.player

import com.luciel.player.FocusLogic.Companion.GAIN
import com.luciel.player.FocusLogic.Companion.LOSS
import com.luciel.player.FocusLogic.Companion.LOSS_TRANSIENT
import com.luciel.player.FocusLogic.Companion.LOSS_TRANSIENT_CAN_DUCK
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FocusLogicTest {
    @Test fun firstPlayRequests() {
        val f = FocusLogic()
        assertTrue(f.needsRequest()); assertTrue(f.onRequest(true)); assertFalse(f.needsRequest())
    }
    @Test fun callPausesAndResumes() {
        val f = FocusLogic(); f.onRequest(true)
        assertEquals(listOf("pause" to 0L), f.onChange(LOSS_TRANSIENT, playing = true))
        assertTrue(f.resumeOnGain)
        assertEquals(listOf("duck" to 0L, "play" to 0L), f.onChange(GAIN, playing = false))
        assertFalse(f.resumeOnGain)
    }
    @Test fun playDuringCallAsksAgain() {
        // the old code kept hasFocus=true after a transient loss, so a play press during a call played over it
        val f = FocusLogic(); f.onRequest(true)
        f.onChange(LOSS_TRANSIENT, playing = true)
        assertTrue(f.needsRequest())
        assertFalse(f.onRequest(false))      // Android refuses while the call holds focus -> stay paused
        assertTrue(f.needsRequest())
    }
    @Test fun manualPauseCancelsAutoResume() {
        val f = FocusLogic(); f.onRequest(true)
        f.onChange(LOSS_TRANSIENT, playing = true)
        f.onUserPause()
        assertEquals(listOf("duck" to 0L), f.onChange(GAIN, playing = false))
    }
    @Test fun pausedDuringLossDoesNotResume() {
        val f = FocusLogic(); f.onRequest(true)
        f.onChange(LOSS_TRANSIENT, playing = false)
        assertEquals(listOf("duck" to 0L), f.onChange(GAIN, playing = false))
    }
    @Test fun permanentLoss() {
        val f = FocusLogic(); f.onRequest(true)
        assertEquals(listOf("pause" to 0L), f.onChange(LOSS, playing = true))
        assertTrue(f.needsRequest()); assertFalse(f.resumeOnGain)
        assertEquals(listOf("duck" to 0L), f.onChange(GAIN, playing = false))
    }
    @Test fun duck() {
        val f = FocusLogic(); f.onRequest(true)
        assertEquals(listOf("duck" to 1L), f.onChange(LOSS_TRANSIENT_CAN_DUCK, playing = true))
        assertFalse(f.needsRequest())
        assertEquals(listOf("duck" to 0L), f.onChange(GAIN, playing = true))
    }
}
