package com.luciel.player

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Cover-tinted colours: a vivid accent, a second accent and a dark background, from ARGB pixels. */
data class Tint(val accent: Int, val accent2: Int, val bgDark: Int, val hue: Float, val sat: Float, val light: Float) {
    fun hex(c: Int) = String.format("#%06X", c and 0xFFFFFF)
    /** palette family used to pick a Luciel base palette/scene: aero / blue / red / slime */
    val family: String get() = when {
        sat < 0.18f -> "aero"
        hue < 20f || hue >= 330f -> "red"
        hue < 70f -> "red"          // oranges / ambers go with the ember palette
        hue < 170f -> "slime"
        hue < 260f -> "blue"
        else -> "red"               // magenta / purple
    }
}

object CoverPalette {
    fun hsl(c: Int): FloatArray {
        val r = (c shr 16 and 255) / 255f; val g = (c shr 8 and 255) / 255f; val b = (c and 255) / 255f
        val mx = max(r, max(g, b)); val mn = min(r, min(g, b)); val l = (mx + mn) / 2f
        if (mx == mn) return floatArrayOf(0f, 0f, l)
        val d = mx - mn
        val s = if (l > 0.5f) d / (2f - mx - mn) else d / (mx + mn)
        var h = when (mx) { r -> (g - b) / d + (if (g < b) 6f else 0f); g -> (b - r) / d + 2f; else -> (r - g) / d + 4f }
        h *= 60f
        return floatArrayOf(h, s, l)
    }

    fun fromHsl(h: Float, s: Float, l: Float): Int {
        val c = (1 - abs(2 * l - 1)) * s; val hp = (h % 360f) / 60f; val x = c * (1 - abs(hp % 2 - 1))
        val (r1, g1, b1) = when { hp < 1 -> Triple(c, x, 0f); hp < 2 -> Triple(x, c, 0f); hp < 3 -> Triple(0f, c, x); hp < 4 -> Triple(0f, x, c); hp < 5 -> Triple(x, 0f, c); else -> Triple(c, 0f, x) }
        val m = l - c / 2
        fun ch(v: Float) = ((v + m) * 255f).toInt().coerceIn(0, 255)
        return (0xFF shl 24) or (ch(r1) shl 16) or (ch(g1) shl 8) or ch(b1)
    }

    /**
     * Hue histogram (24 buckets) weighted by saturation; the strongest bucket becomes the accent, the strongest bucket at
     * least 40 degrees away the second accent. Greyscale covers keep a soft silver-blue accent.
     */
    fun extract(pixels: IntArray): Tint {
        val buckets = FloatArray(24); val sumS = FloatArray(24); val sumL = FloatArray(24); val cnt = IntArray(24)
        var lum = 0f; var n = 0
        for (p in pixels) {
            if ((p ushr 24) < 128) continue
            val (h, s, l) = hsl(p).let { Triple(it[0], it[1], it[2]) }
            lum += l; n++
            if (s < 0.2f || l < 0.12f || l > 0.92f) continue
            val i = ((h / 15f).toInt()).coerceIn(0, 23)
            val w = s * (1f - abs(l - 0.5f))
            buckets[i] += w; sumS[i] += s; sumL[i] += l; cnt[i]++
        }
        val light = if (n > 0) lum / n else 0.5f
        val best = buckets.indices.maxByOrNull { buckets[it] } ?: 0
        val total = buckets.sum()
        if (total < pixels.size * 0.01f || cnt[best] == 0) {
            return Tint(0xFF9FC4E8.toInt(), 0xFFD8E6F3.toInt(), 0xFF1C2430.toInt(), 210f, 0.1f, light)
        }
        val hue = best * 15f + 7.5f
        val sat = (sumS[best] / cnt[best]).coerceIn(0.45f, 0.95f)
        var second = -1
        for (i in buckets.indices) {
            val d = minOf(abs(i - best), 24 - abs(i - best))
            if (d >= 3 && cnt[i] > 0 && (second < 0 || buckets[i] > buckets[second])) second = i
        }
        val hue2 = if (second >= 0 && buckets[second] > buckets[best] * 0.15f) second * 15f + 7.5f else (hue + 35f) % 360f
        return Tint(
            accent = fromHsl(hue, sat, 0.6f),
            accent2 = fromHsl(hue2, (sat * 0.9f).coerceAtLeast(0.4f), 0.68f),
            bgDark = fromHsl(hue, (sat * 0.45f), 0.1f),
            hue = hue, sat = sumS[best] / cnt[best], light = light,
        )
    }
}
