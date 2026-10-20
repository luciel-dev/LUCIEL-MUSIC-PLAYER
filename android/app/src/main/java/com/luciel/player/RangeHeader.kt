package com.luciel.player

/** HTTP Range parsing for the in-WebView media server (only single ranges, which is what Chromium's media stack sends). */
object RangeHeader {
    /** @return inclusive [start, end] clamped to the file, or null for "whole file" / unsatisfiable */
    fun parse(header: String?, size: Long): LongArray? {
        if (header == null || size <= 0) return null
        val m = Regex("""^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$""").find(header) ?: return null
        val (a, b) = m.destructured
        if (a.isEmpty() && b.isEmpty()) return null
        return if (a.isEmpty()) {                       // suffix: last N bytes
            val n = b.toLong().coerceAtMost(size); if (n <= 0) null else longArrayOf(size - n, size - 1)
        } else {
            val s = a.toLong(); if (s >= size) return null
            val e = if (b.isEmpty()) size - 1 else b.toLong().coerceAtMost(size - 1)
            if (e < s) null else longArrayOf(s, e)
        }
    }
}
