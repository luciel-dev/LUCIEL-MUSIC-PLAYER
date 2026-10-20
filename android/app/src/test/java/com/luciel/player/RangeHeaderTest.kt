package com.luciel.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RangeHeaderTest {
    @Test fun openEnded() = assertArrayEquals(longArrayOf(0, 999), RangeHeader.parse("bytes=0-", 1000))
    @Test fun closed() = assertArrayEquals(longArrayOf(100, 199), RangeHeader.parse("bytes=100-199", 1000))
    @Test fun clampedEnd() = assertArrayEquals(longArrayOf(900, 999), RangeHeader.parse("bytes=900-5000", 1000))
    @Test fun suffix() = assertArrayEquals(longArrayOf(872, 999), RangeHeader.parse("bytes=-128", 1000))
    @Test fun suffixLargerThanFile() = assertArrayEquals(longArrayOf(0, 999), RangeHeader.parse("bytes=-5000", 1000))
    @Test fun spaces() = assertArrayEquals(longArrayOf(5, 10), RangeHeader.parse(" bytes = 5 - 10 ", 1000))
    @Test fun invalid() {
        assertNull(RangeHeader.parse(null, 1000)); assertNull(RangeHeader.parse("bytes=1000-", 1000)); assertNull(RangeHeader.parse("bytes=50-10", 1000))
        assertNull(RangeHeader.parse("bytes=-", 1000)); assertNull(RangeHeader.parse("items=0-1", 1000)); assertNull(RangeHeader.parse("bytes=0-1,5-6", 1000))
        assertNull(RangeHeader.parse("bytes=0-", 0))
    }
}
