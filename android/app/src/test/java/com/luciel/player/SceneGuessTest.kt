package com.luciel.player

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SceneGuessTest {
    @Test fun genreFromWords() {
        assertEquals("lofi", SceneGuess.genre("rainy day lofi beats", null, null))
        assertEquals("synthwave", SceneGuess.genre("Night Drive", "Retrowave Nights", "Neon Arcade"))
        assertEquals("classical", SceneGuess.genre("Nocturne in E-flat", null, "Chopin"))
        assertEquals("hip hop", SceneGuess.genre("Freestyle", null, null))
        assertNull(SceneGuess.genre("Blinding Lights", "After Hours", "The Weeknd"))
        assertNull(SceneGuess.genre(null, null, null))
    }

    @Test fun wholeWordsOnly() {
        // "trap" must not match "strap", "pop" must not match "popcorn"
        assertNull(SceneGuess.genre("Strap in", null, null))
        assertNull(SceneGuess.genre("Popcorn", null, null))
    }

    @Test fun sceneFallbacks() {
        assertEquals("synthwave", SceneGuess.sceneFor("synthwave", "blue", 120f, 0.5f))
        assertEquals("mood-sleepy", SceneGuess.sceneFor(null, "blue", 70f, 0.1f))
        assertEquals("mood-hype", SceneGuess.sceneFor(null, "blue", 150f, 0.8f))
        assertEquals("slime-rave", SceneGuess.sceneFor(null, "slime", 150f, 0.8f))
        assertEquals("red-rock", SceneGuess.sceneFor(null, "red", 110f, 0.5f))
        assertEquals("aero-ambient", SceneGuess.sceneFor(null, "aero", 0f, 0f))
    }

    @Test fun tiers() {
        assertEquals("slow", SceneGuess.tier(80f)); assertEquals("mid", SceneGuess.tier(90f))
        assertEquals("mid", SceneGuess.tier(125f)); assertEquals("fast", SceneGuess.tier(126f)); assertEquals("mid", SceneGuess.tier(0f))
    }

    /** every scene id we can pick must exist in Luciel's shipped scenes.json (synced web assets) */
    @Test fun allScenesExistInAssets() {
        val f = listOf(File("src/main/assets/www/art/scenes.json"), File("app/src/main/assets/www/art/scenes.json")).firstOrNull { it.exists() }
            ?: return   // assets not synced in this checkout
        val arr = JSONObject(f.readText()).getJSONArray("scenes")
        val ids = (0 until arr.length()).map { arr.getJSONObject(it).getString("id") }.toSet()
        val genres = listOf(null, "lofi", "jazz", "classical", "hip hop", "synthwave", "rock", "electronic", "ambient", "pop", "sad", "romantic")
        for (g in genres) for (fam in listOf("aero", "red", "slime", "blue")) for (bpm in listOf(0f, 70f, 110f, 150f)) for (e in listOf(0.1f, 0.8f)) {
            val s = SceneGuess.sceneFor(g, fam, bpm, e); assertTrue("missing scene $s", s in ids)
        }
    }
}
