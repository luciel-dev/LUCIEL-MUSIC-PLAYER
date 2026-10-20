package com.luciel.player

import com.luciel.player.FloaterGeometry.Bounds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FloaterGeometryTest {
    // 1080 x 2340 phone, 63 px status bar, 63 px gesture bar
    private val b = Bounds(0, 63, 1080, 2340 - 63)

    @Test fun clampKeepsOutOfSystemBars() {
        assertEquals(0 to 63, FloaterGeometry.clamp(-50, 0, 800, 300, b))
        assertEquals(280 to 2277 - 300, FloaterGeometry.clamp(900, 3000, 800, 300, b))
    }
    @Test fun snapsNearEdges() {
        assertEquals(0 to 500, FloaterGeometry.snap(40, 500, 800, 300, b, 63, false))
        assertEquals(280 to 500, FloaterGeometry.snap(250, 500, 800, 300, b, 63, false))
        assertEquals(100 to 500, FloaterGeometry.snap(100, 500, 800, 300, b, 63, false))   // too far from an edge: stays
        assertEquals(100 to 63, FloaterGeometry.snap(100, 100, 800, 300, b, 63, false))
    }
    @Test fun bubbleAlwaysSticksToASide() {
        assertEquals(0 to 900, FloaterGeometry.snap(300, 900, 168, 168, b, 63, true))
        assertEquals(1080 - 168 to 900, FloaterGeometry.snap(700, 900, 168, 168, b, 63, true))
    }
    @Test fun heights() {
        assertEquals(64f, FloaterGeometry.heightDp(FloaterGeometry.BUBBLE, 64f, false))
        assertEquals(112f, FloaterGeometry.heightDp(FloaterGeometry.COMPACT, 316f, false))
        assertEquals(126f, FloaterGeometry.heightDp(FloaterGeometry.COMPACT, 316f, true))
        val large = FloaterGeometry.heightDp(FloaterGeometry.LARGE, 252f, false)
        assertTrue(large > 252f && large < 252f * 1.6f)
        assertEquals("compact", FloaterGeometry.normMode("weird"))
    }
}
