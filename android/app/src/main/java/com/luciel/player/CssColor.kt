package com.luciel.player

/** Parses the CSS colour values the page reports (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba()) into ARGB ints. */
object CssColor {
    fun parse(v: String?, fallback: Int): Int {
        val s = v?.trim()?.lowercase() ?: return fallback
        try {
            if (s.startsWith("#")) {
                val h = s.substring(1)
                return when (h.length) {
                    3 -> (0xFF shl 24) or (dup(h[0]) shl 16) or (dup(h[1]) shl 8) or dup(h[2])
                    6 -> (0xFF shl 24) or h.toInt(16)
                    8 -> { val rgb = h.substring(0, 6).toInt(16); val a = h.substring(6).toInt(16); (a shl 24) or rgb }
                    else -> fallback
                }
            }
            val m = Regex("""^rgba?\(([^)]*)\)$""").find(s) ?: return fallback
            val p = m.groupValues[1].split(',', ' ', '/').filter { it.isNotBlank() }
            if (p.size < 3) return fallback
            fun ch(x: String) = if (x.endsWith("%")) (x.dropLast(1).toFloat() * 2.55f).toInt() else x.toFloat().toInt()
            val a = if (p.size > 3) (if (p[3].endsWith("%")) p[3].dropLast(1).toFloat() / 100f else p[3].toFloat()) else 1f
            return ((a.coerceIn(0f, 1f) * 255).toInt() shl 24) or (ch(p[0]).coerceIn(0, 255) shl 16) or (ch(p[1]).coerceIn(0, 255) shl 8) or ch(p[2]).coerceIn(0, 255)
        } catch (_: Throwable) { return fallback }
    }
    private fun dup(c: Char) = c.digitToInt(16) * 17
}
