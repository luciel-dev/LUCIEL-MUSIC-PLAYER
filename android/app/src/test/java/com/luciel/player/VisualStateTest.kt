package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.1.3: the page's published stage (scene / outfit / palette / visualizer) parsed for the floater + Spotify card. */
class VisualStateTest {
    private val pack = """{"scene":"lucielle-styles/city-punk","sceneName":"City Punk","kind":"layered","bg":"/data/user/0/x/files/visual/lucielle-styles_city-punk_bg-123","glow":"",
        "pixel":false,"fullArt":false,"char":{"use":"custom","name":"Lucielle (City Punk)","scale":1.1,
        "dance":{"slow":{"file":"/f/slow","frames":48,"cols":8,"beats":8,"loopBpm":90},"mid":{"file":"/f/mid","frames":48,"cols":8,"beats":8,"loopBpm":120},"fast":{"file":"","frames":48,"cols":8}},
        "idle":"/f/idle","emotes":{"happy":{"file":"/f/happy","frames":24,"cols":8,"beats":4,"loopBpm":120}},"stills":{"shy":"/f/shy"},"events":{"start":"happy","drop":"happy"}},
        "accent":"#ff2d48","accent2":"rgb(255, 120, 80)","bg2":"#1a0a10","bg3":"#2a0c14","text":"#ffffff","skin":"aero","palette":"red",
        "vizMode":"scope","mascot":true,"mascotSize":"l","glowColor":"#ff3366","at":123}"""

    @Test fun parsesPackSceneOutfitAndTheme() {
        val v = VisualState.parse(pack)!!
        assertTrue(v.hasState)
        assertEquals("lucielle-styles/city-punk", v.sceneId); assertEquals("City Punk", v.sceneName)
        assertTrue(v.bg.endsWith("bg-123"))
        assertEquals("custom", v.charUse); assertEquals(1.1f, v.charScale, 1e-4f)
        assertEquals(setOf("slow", "mid"), v.dances.keys)                 // a loop without a file is dropped
        assertEquals(CharSheet("/f/mid", 48, 8, 8f, 120f), v.dances["mid"])
        assertEquals("/f/idle", v.idle); assertEquals("/f/shy", v.emoteStills["shy"]); assertEquals(24, v.emotes["happy"]!!.frames)
        assertEquals("scope", v.vizMode); assertEquals(0.98f, v.charHeight, 1e-4f)
        assertEquals(0xFFFF2D48.toInt(), v.theme.accent); assertEquals("red", v.theme.palette)
        // "bg" is the scene picture; the panel colour came as bg2
        assertEquals(CssColor.parse("#1a0a10", 0), v.theme.bg)
        assertEquals(CssColor.parse("#ff3366", 0), v.glowColor)
    }

    @Test fun defaultsAndBadInput() {
        assertNull(VisualState.parse("not json"))
        val v = VisualState.parse("""{"scene":"hiphop","bg":"asset:www/art/hiphop.webp","char":{"scale":9}}""")!!
        assertEquals("lucielle", v.charUse); assertEquals(1f, v.charScale, 0f)   // out-of-range scale ignored
        assertEquals("spectrum", v.vizMode); assertEquals(0.84f, v.charHeight, 1e-4f); assertTrue(v.mascot)
        assertFalse(VisualState().hasState)
    }

    @Test fun fileKeysAreSafe() {
        assertEquals("lucielle-styles_city-punk_dance-mid-1048576", VisualState.fileKey("lucielle-styles/city-punk/dance-mid-1048576"))
        assertEquals("x", VisualState.fileKey("../../"))
        assertFalse(VisualState.fileKey("a/../../etc/passwd").contains("/"))
        assertTrue(VisualState.fileKey("y".repeat(500)).length <= 120)
    }
}
