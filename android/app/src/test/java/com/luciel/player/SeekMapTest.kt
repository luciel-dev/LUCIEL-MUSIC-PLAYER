package com.luciel.player

import org.junit.Assert.assertEquals
import org.junit.Test

class SeekMapTest {
    @Test fun nextPrev() {
        assertEquals("next" to 0L, SeekMap.command(SeekMap.SEEK_TO_NEXT, 2, 1, 0))
        assertEquals("next" to 0L, SeekMap.command(SeekMap.SEEK_TO_NEXT_MEDIA_ITEM, 2, 1, 0))
        assertEquals("prev" to 0L, SeekMap.command(SeekMap.SEEK_TO_PREVIOUS, 0, 1, 0))
        // Media3 maps "previous" after 3 s to a seek to 0 in the same item
        assertEquals("seek" to 0L, SeekMap.command(SeekMap.SEEK_TO_PREVIOUS, 1, 1, 0))
    }
    @Test fun seekInItem() {
        assertEquals("seek" to 42_000L, SeekMap.command(SeekMap.SEEK_IN_CURRENT, 1, 1, 42_000))
        assertEquals("seek" to 0L, SeekMap.command(SeekMap.SEEK_IN_CURRENT, 1, 1, -5))
        assertEquals("seek" to 5_000L, SeekMap.command(SeekMap.SEEK_TO_MEDIA_ITEM, 0, 0, 5_000))
        assertEquals("next" to 0L, SeekMap.command(SeekMap.SEEK_TO_MEDIA_ITEM, 1, 0, 0))
        assertEquals("prev" to 0L, SeekMap.command(SeekMap.SEEK_TO_MEDIA_ITEM, 0, 1, 0))
    }
}
