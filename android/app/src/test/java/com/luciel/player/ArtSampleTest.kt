package com.luciel.player

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Color
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** the hero-cover bug: the same cover arrives as a new Bitmap object on every metadata read */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class ArtSampleTest {
    private fun cover(c: Int) = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(c); setPixel(9, 9, Color.WHITE) }
    @Test fun sameCoverCopiedKeepsItsKey() {
        val a = cover(Color.rgb(200, 30, 90)); val copy = a.copy(Bitmap.Config.ARGB_8888, false)
        assertNotEquals(a.generationId, copy.generationId)   // what 1.1.3 keyed on: changes per copy
        assertEquals(ArtRules.sample(a), ArtRules.sample(copy))
        assertEquals(ArtRules.key("k", null, 64, 64, ArtRules.sample(a)), ArtRules.key("k", null, copy.width, copy.height, ArtRules.sample(copy)))
        assertNotEquals(ArtRules.sample(a), ArtRules.sample(cover(Color.rgb(20, 30, 200))))
        assertEquals(0, ArtRules.sample(null))
    }
}
