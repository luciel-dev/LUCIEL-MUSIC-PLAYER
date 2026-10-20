package com.luciel.player

/** Sizes and edge snapping for Luciel's own floater (pure maths, unit-tested). All values in px unless noted. */
object FloaterGeometry {
    const val COMPACT = "compact"; const val LARGE = "large"; const val BUBBLE = "bubble"
    const val BUBBLE_DP = 64
    const val SNAP_DP = 24

    fun normMode(m: String?) = when (m) { LARGE, BUBBLE -> m; else -> COMPACT }

    /** window height for a mode / width (dp in, dp out) */
    fun heightDp(mode: String, widthDp: Float, classic: Boolean): Float = when (mode) {
        BUBBLE -> BUBBLE_DP.toFloat()
        LARGE -> (if (classic) 22f else 0f) + stageHeightDp(widthDp) + 150f
        else -> if (classic) 126f else 112f
    }
    fun stageHeightDp(widthDp: Float) = (widthDp * 0.86f).let { Math.round(it).toFloat() }

    data class Bounds(val left: Int, val top: Int, val right: Int, val bottom: Int)

    /** keep the window inside the safe area (status bar / gesture bar / cutout excluded) */
    fun clamp(x: Int, y: Int, w: Int, h: Int, b: Bounds): Pair<Int, Int> =
        x.coerceIn(b.left, maxOf(b.left, b.right - w)) to y.coerceIn(b.top, maxOf(b.top, b.bottom - h))

    /** after a drag: clamp, then stick to an edge within `snap` px; the bubble always sticks to the nearer side */
    fun snap(x: Int, y: Int, w: Int, h: Int, b: Bounds, snap: Int, bubble: Boolean): Pair<Int, Int> {
        var (nx, ny) = clamp(x, y, w, h, b)
        val maxX = maxOf(b.left, b.right - w); val maxY = maxOf(b.top, b.bottom - h)
        if (bubble) nx = if (nx + w / 2 < (b.left + b.right) / 2) b.left else maxX
        else { if (nx - b.left <= snap) nx = b.left else if (maxX - nx <= snap) nx = maxX }
        if (ny - b.top <= snap) ny = b.top else if (maxY - ny <= snap) ny = maxY
        return nx to ny
    }
}
