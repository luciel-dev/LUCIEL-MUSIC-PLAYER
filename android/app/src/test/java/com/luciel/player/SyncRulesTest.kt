package com.luciel.player

import org.junit.Assert.assertNull
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

    @Test fun coverUrisWeCanLoad() {
        assertEquals("https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcdef01", ArtRules.resolve("spotify:image:ab67616d0000b273abcdef0123456789abcdef01"))
        assertEquals("content://media/external/audio/albumart/3", ArtRules.resolve("content://media/external/audio/albumart/3"))
        assertEquals("https://i.scdn.co/image/ab67", ArtRules.resolve("https://i.scdn.co/image/ab67"))
        assertEquals("https://mosaic.scdn.co/640/abc", ArtRules.resolve("https://mosaic.scdn.co/640/abc"))
        assertEquals("https://image-cdn-ak.spotifycdn.com/image/ab67", ArtRules.resolve("https://image-cdn-ak.spotifycdn.com/image/ab67"))
        assertNull(ArtRules.resolve("https://evil.example/x.jpg")); assertNull(ArtRules.resolve("http://i.scdn.co/image/ab67"))
        assertNull(ArtRules.resolve("https://i.scdn.co.evil.example/x")); assertNull(ArtRules.resolve("https://user@i.scdn.co/x"))
        assertNull(ArtRules.resolve("spotify:image:../../x"))
        // ALBUM_ART_URI, ART_URI, DISPLAY_ICON_URI: first one we can actually load
        assertEquals("https://i.scdn.co/image/ab67", ArtRules.pickUri(null, "spotify:track:xyz", "https://i.scdn.co/image/ab67"))
        assertNull(ArtRules.pickUri(null, "", null))
    }
}
