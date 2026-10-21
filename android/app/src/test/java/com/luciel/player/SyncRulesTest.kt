package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** 1.1.3: tempo chip wording + cover-art identity (a picture arriving after the title must not be skipped). */
class SyncRulesTest {
    @Test fun tempoLabelSaysWhereTheBeatComesFrom() {
        assertEquals("♩ 121 BPM · live", TempoLabel.of(121.4f, "live"))
        assertEquals("♩ 124 BPM · tapped", TempoLabel.of(123.6f, "tap"))
        assertEquals("♩ 120 BPM · steady · tap", TempoLabel.of(120f, "tempo"))
        assertEquals("♩ 120 BPM · steady · tap", TempoLabel.of(0f, null))
    }

    @Test fun coverArtKeyChangesWithThePicture() {
        val noArt = ArtRules.key("spotify|Song|Artist", null, 0, 0, 0)
        val withArt = ArtRules.key("spotify|Song|Artist", null, 640, 640, 17)
        val newer = ArtRules.key("spotify|Song|Artist", null, 640, 640, 18)
        assertNotEquals(noArt, withArt)        // Spotify: title first, bitmap in a later metadata update
        assertNotEquals(withArt, newer)
        assertEquals(withArt, ArtRules.key("spotify|Song|Artist", null, 640, 640, 17))
        assertNotEquals(withArt, ArtRules.key("spotify|Next|Artist", null, 640, 640, 17))
    }
}
