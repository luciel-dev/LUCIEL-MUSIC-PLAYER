package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Test

class CssColorTest {
    @Test fun hex() {
        assertEquals(0xFFFF2D48.toInt(), CssColor.parse("#ff2d48", 0))
        assertEquals(0xFFFFFFFF.toInt(), CssColor.parse(" #fff ", 0))
        assertEquals(0x80112233.toInt(), CssColor.parse("#11223380", 0))
    }
    @Test fun rgb() {
        assertEquals(0xFF0A141E.toInt(), CssColor.parse("rgb(10, 20, 30)", 0))
        assertEquals(0x7F387FFF.toInt(), CssColor.parse("rgba(56,127,255,.5)", 0))
    }
    @Test fun junkFallsBack() {
        assertEquals(7, CssColor.parse("color-mix(in srgb, red, blue)", 7))
        assertEquals(7, CssColor.parse("", 7)); assertEquals(7, CssColor.parse(null, 7)); assertEquals(7, CssColor.parse("#12", 7))
    }
}
