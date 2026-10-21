package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WeatherPlaceTest {
    @Test fun roundsToCoarse() {
        assertEquals(41.9, WeatherPlace.round(41.8781), 1e-9)
        assertEquals(-87.6, WeatherPlace.round(-87.6298), 1e-9)
        assertEquals(0.0, WeatherPlace.round(0.04), 1e-9)
    }
    @Test fun jsonHasOnlyCoarsePosition() {
        val j = org.json.JSONObject(WeatherPlace.json(41.87811, -87.62979))
        assertTrue(j.getBoolean("ok")); assertEquals(41.9, j.getDouble("lat"), 1e-9); assertEquals(-87.6, j.getDouble("lon"), 1e-9)
        assertEquals(3, j.length())
    }
    @Test fun packZipDetection() {
        assertTrue(WeatherPlace.isPackZip("application/zip", "lucielle-genres-pack.zip"))
        assertTrue(WeatherPlace.isPackZip("application/x-zip-compressed", "x"))
        assertTrue(WeatherPlace.isPackZip("application/octet-stream", "Lucielle-Genres.ZIP"))
        assertTrue(WeatherPlace.isPackZip(null, "pack.zip"))
        assertFalse(WeatherPlace.isPackZip("audio/mpeg", "song.mp3"))
        assertFalse(WeatherPlace.isPackZip("audio/zip", "odd.zip"))
        assertFalse(WeatherPlace.isPackZip("application/ogg", "track.ogg"))
    }
}
