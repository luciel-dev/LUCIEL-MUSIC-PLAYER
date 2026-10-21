package com.luciel.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.1.3: the native stage moves like the page's (js/luciel.js): tiers, beat-synced loops, outfit / emote choice, bubble crop. */
class VisualRulesTest {
    private val mid = CharSheet("/f/mid", 48, 8, 8f, 120f)
    private val slow = CharSheet("/f/slow", 48, 8, 8f, 90f)
    private val happy = CharSheet("/f/happy", 24, 8, 4f, 120f)
    private val custom = VisualState(sceneId = "p/city-punk", charUse = "custom", dances = mapOf("mid" to mid, "slow" to slow), idle = "/f/idle",
        emotes = mapOf("happy" to happy), emoteStills = mapOf("shy" to "/f/shy"), events = mapOf("start" to "happy"))

    @Test fun tiersMatchThePage() {
        // page: !bpm ? 'mid' : bpm < 96 ? 'slow' : bpm <= 126 ? 'mid' : 'fast'
        assertEquals("mid", VisualRules.tier(0f)); assertEquals("slow", VisualRules.tier(95.9f)); assertEquals("mid", VisualRules.tier(96f))
        assertEquals("mid", VisualRules.tier(126f)); assertEquals("fast", VisualRules.tier(126.5f))
    }

    @Test fun loopsStayBeatLocked() {
        assertEquals(1.0, VisualRules.mult(121f, 120f), 0.0)
        assertEquals(0.5, VisualRules.mult(240f, 120f), 0.0)       // double time → half speed loop
        assertEquals(2.0, VisualRules.mult(60f, 120f), 0.0)
        // 8-beat 48-frame loop at its own tempo: beat 0 → frame 0, beat 4 → frame 24, beat 8 wraps
        assertEquals(0, VisualRules.frameIndex(0.0, 120f, mid)); assertEquals(24, VisualRules.frameIndex(4.0, 120f, mid)); assertEquals(0, VisualRules.frameIndex(8.0, 120f, mid))
        assertEquals(47, VisualRules.frameIndex(-0.01, 120f, mid))
        assertArrayEquals(intArrayOf(192, 96, 288, 192), VisualRules.cell(10, mid, 768, 576))   // 8 cols × 6 rows of 96 px
    }

    @Test fun picksOutfitDanceIdleAndEmotes() {
        assertEquals(VisualRules.Pick.Loop(mid), VisualRules.pick(custom, true, 121f, null))
        assertEquals(VisualRules.Pick.Loop(slow), VisualRules.pick(custom, true, 80f, null))
        assertEquals(VisualRules.Pick.Loop(mid), VisualRules.pick(custom, true, 150f, null))   // no fast loop: mid
        assertEquals(VisualRules.Pick.Still("/f/idle"), VisualRules.pick(custom, false, 121f, null))
        assertEquals(VisualRules.Pick.Loop(happy), VisualRules.pick(custom, true, 121f, "happy"))
        assertEquals(VisualRules.Pick.Still("/f/shy"), VisualRules.pick(custom, false, 121f, "shy"))
        assertEquals("happy", VisualRules.emoteFor(custom, "start"))
        // built-in Lucielle
        val b = VisualState(sceneId = "hiphop")
        assertEquals(VisualRules.Pick.BuiltinDance("fast"), VisualRules.pick(b, true, 140f, null))
        assertEquals(VisualRules.Pick.BuiltinPose("idle"), VisualRules.pick(b, false, 140f, null))
        assertEquals(VisualRules.Pick.BuiltinPose("surprised"), VisualRules.pick(b, true, 140f, "surprised"))
        assertEquals("surprised", VisualRules.emoteFor(b, "start"))
        // Lucielle wearing pack dance loops (use = lucielle + dance) dances with them
        val lp = VisualState(sceneId = "p/x", charUse = "lucielle", dances = mapOf("mid" to mid))
        assertEquals(VisualRules.Pick.Loop(mid), VisualRules.pick(lp, true, 110f, null))
        assertEquals(VisualRules.Pick.BuiltinDance("fast"), VisualRules.pick(lp, true, 140f, null))
        // mascot off / no character
        assertEquals(VisualRules.Pick.None, VisualRules.pick(b.copy(mascot = false), true, 120f, null))
        assertEquals(VisualRules.Pick.None, VisualRules.pick(b.copy(charUse = "none"), true, 120f, null))
    }

    @Test fun bubbleCropsAroundTheHead() {
        for (size in listOf("s", "m", "l")) {
            val v = VisualState(sceneId = "x", mascotSize = size)
            val (left, top, s) = VisualRules.headCrop(v.charHeight).toList()
            val headTop = 1f - 0.04f - v.charHeight
            assertTrue("$size inside", left >= 0f && top >= 0f && left + s <= 1f && top + s <= 1f)
            assertTrue("$size head in crop", headTop + v.charHeight * 0.05f >= top && headTop + v.charHeight * 0.2f <= top + s)
            assertEquals(0.5f, left + s / 2, 1e-4f)
        }
    }
}
