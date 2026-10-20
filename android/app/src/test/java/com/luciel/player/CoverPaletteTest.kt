package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoverPaletteTest {
    private fun solid(c: Int, n: Int = 400) = IntArray(n) { c }

    @Test fun hslRoundTrip() {
        for (c in listOf(0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0xFF3366CC.toInt(), 0xFFFFAA00.toInt())) {
            val h = CoverPalette.hsl(c); val back = CoverPalette.fromHsl(h[0], h[1], h[2])
            for (sh in listOf(16, 8, 0)) assertEquals((c shr sh and 255).toFloat(), (back shr sh and 255).toFloat(), 2f)
        }
    }

    @Test fun redCoverGivesRedFamily() {
        val t = CoverPalette.extract(solid(0xFFE0203A.toInt()))
        assertEquals("red", t.family)
        val h = CoverPalette.hsl(t.accent)[0]; assertTrue("hue $h", h >= 345f || h < 15f)
        assertTrue("dark bg", CoverPalette.hsl(t.bgDark)[2] < 0.15f)
    }

    @Test fun blueAndGreenFamilies() {
        assertEquals("blue", CoverPalette.extract(solid(0xFF2060E0.toInt())).family)
        assertEquals("slime", CoverPalette.extract(solid(0xFF30D050.toInt())).family)
    }

    @Test fun greyscaleCoverFallsBackToSilver() {
        val px = IntArray(400) { i -> val v = (i % 256); (0xFF shl 24) or (v shl 16) or (v shl 8) or v }
        assertEquals("aero", CoverPalette.extract(px).family)
    }

    @Test fun secondAccentDiffersFromFirst() {
        val px = IntArray(600) { if (it < 400) 0xFFFF2090.toInt() else 0xFF20B0FF.toInt() }
        val t = CoverPalette.extract(px)
        val h1 = CoverPalette.hsl(t.accent)[0]; val h2 = CoverPalette.hsl(t.accent2)[0]
        val d = minOf(kotlin.math.abs(h1 - h2), 360 - kotlin.math.abs(h1 - h2))
        assertTrue("accents $h1 / $h2", d >= 40f)
        assertEquals("#", t.hex(t.accent).take(1)); assertEquals(7, t.hex(t.accent).length)
    }

    @Test fun transparentPixelsIgnored() {
        val px = IntArray(400) { if (it < 300) 0x00FF0000 else 0xFF2060E0.toInt() }
        assertEquals("blue", CoverPalette.extract(px).family)
    }
}
