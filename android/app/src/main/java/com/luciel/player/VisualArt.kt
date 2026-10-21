package com.luciel.player

import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

/**
 * Draws Luciel's current stage ([VisualHub.current]) for the native views: the same scene picture (pack scenes too),
 * glow map, Lucielle in the same outfit (pack sprite sheets) with emotes, theme colours and visualizer style.
 * Pictures are decoded off the main thread; until one is ready the previous / built-in art is used.
 */
class VisualArt(private val assets: LucielleAssets, private val onReady: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val px = Paint().apply { isFilterBitmap = false; isAntiAlias = false }
    private val add = Paint(Paint.FILTER_BITMAP_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.ADD) }
    private val src = Rect(); private val dst = RectF(); private val r2 = RectF(); private val r3 = RectF()
    private var pixBmp: Bitmap? = null; private var pixCanvas: Canvas? = null
    private val bars = FloatArray(28)
    private var glowKey = ""; private var glowShader: Shader? = null
    private val clipPath = Path(); private val stageBox = RectF()

    // ------------------------------------------------------------------ bitmaps (async, small LRU)
    private val cache = object : LinkedHashMap<String, Bitmap>(8, 0.75f, true) {
        override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Bitmap>?): Boolean = size > 8
    }
    private val pending = HashSet<String>()
    private val failed = HashSet<String>()

    /** [maxPx] = longest side to decode to (power-of-two sample); 0 = full size */
    fun bitmap(path: String, maxPx: Int): Bitmap? {
        if (path.isEmpty()) return null
        val key = "$path@$maxPx"
        synchronized(cache) { cache[key]?.let { return it } }
        if (key in failed || !pending.add(key)) return null
        io.execute {
            val b = try { decode(path, maxPx) } catch (_: Throwable) { null }
            main.post {
                pending.remove(key)
                if (b == null) failed.add(key) else synchronized(cache) { cache[key] = b }
                onReady()
            }
        }
        return null
    }
    private fun decode(path: String, maxPx: Int): Bitmap? {
        val open: () -> java.io.InputStream? = if (path.startsWith("asset:")) ({ assets.open(path.removePrefix("asset:")) }) else ({ File(path).takeIf { it.isFile }?.inputStream() })
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        // (a bounds-only decode always returns null – only a missing file means failure)
        (open() ?: return null).use { BitmapFactory.decodeStream(it, null, o) }
        if (o.outWidth <= 0 || o.outHeight <= 0) return null
        var sample = 1
        if (maxPx > 0) while (maxOf(o.outWidth, o.outHeight) / (sample * 2) >= maxPx) sample *= 2
        return open()?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
    }

    // ------------------------------------------------------------------ emotes (native: the page's stage isn't running while we float)
    private var emoteKey: String? = null; private var emote: String? = null; private var emoteUntil = 0L
    private var bassAvg = 0f; private var lastDrop = 0L
    /** the emote to show now: a reaction to a new song, or to a sudden bass drop (live audio only) */
    fun emoteNow(v: VisualState, trackKey: String?, playing: Boolean, bass: Float, live: Boolean): String? {
        val now = SystemClock.uptimeMillis()
        if (trackKey != null && trackKey != emoteKey) {
            val first = emoteKey == null; emoteKey = trackKey
            if (playing && !first) { emote = VisualRules.emoteFor(v, "start"); emoteUntil = now + 2200 }
        }
        if (live && playing) {
            if (bass > 0.8f && bassAvg < 0.35f && now - lastDrop > 8000) { lastDrop = now; VisualRules.emoteFor(v, "drop")?.let { emote = it; emoteUntil = now + 1800 } }
            bassAvg = bassAvg * 0.97f + bass * 0.03f
        }
        return if (now < emoteUntil) emote else null
    }

    // ------------------------------------------------------------------ stage
    /** whole stage into [box]: background, glow map, bass glow, Lucielle. Returns false if nothing could be drawn. */
    fun drawStage(c: Canvas, box: RectF, v: VisualState, playing: Boolean, bpm: Float, beat: Double, pulse: Float, bass: Float, emote: String?, big: Boolean, charBox: RectF = box, behindChar: (() -> Unit)? = null) {
        val th = v.theme
        val pixel = v.pixel
        drawBackground(c, box, v, pulse, big)
        // light map (neon / lamps painted on black), brightness from the bass and the beat
        if (v.glow.isNotEmpty() && !pixel) bitmap(v.glow, if (big) 720 else 400)?.let { g ->
            val a = ((if (playing) 0.18f + bass * 1.05f + pulse * 0.25f else 0.22f) * 255).toInt().coerceIn(0, 255)
            cover(box, g.width, g.height, 1.04f + pulse * 0.02f); add.alpha = a; c.drawBitmap(g, null, dst, add)
        }
        // bass glow in the theme / scene colour
        val gc = if (v.glowColor != 0) v.glowColor else th.accent
        val gk = "${box.left},${box.top},${box.width()},${box.height()},$gc"
        if (gk != glowKey) { glowKey = gk; glowShader = RadialGradient(box.centerX(), box.top + box.height() * 0.7f, maxOf(box.width(), box.height()) * 0.7f, intArrayOf(opaque(gc), withAlpha(gc, 0)), null, Shader.TileMode.CLAMP) }
        paint.shader = glowShader; paint.alpha = ((0.12f + bass * 0.35f + pulse * 0.15f) * 255).toInt().coerceIn(0, 255)
        c.drawRect(box, paint); paint.shader = null; paint.alpha = 255
        behindChar?.invoke()
        drawCharacter(c, charBox, v, playing, bpm, beat, pulse, emote, big)
    }

    fun drawBackground(c: Canvas, box: RectF, v: VisualState, pulse: Float, big: Boolean) {
        val pixel = v.pixel
        val soft = v.fullArt && !pixel                 // page: blur(6px) + 18 % black over a full illustration
        val path = v.bg.ifEmpty { fallbackScene(v) }
        val want = when { soft -> 96; big -> 900; else -> 480 }
        val bg = bitmap(path, want) ?: bitmap(fallbackScene(v), 480)
        if (bg != null) {
            cover(box, bg.width, bg.height, 1.04f + pulse * 0.02f)
            c.drawBitmap(bg, null, dst, if (pixel) px else bmpPaint)
            if (soft) { paint.color = 0x2E000000; c.drawRect(box, paint) }
        } else { paint.color = opaque(v.theme.bg3); c.drawRect(box, paint) }
    }

    /** built-in art for a scene id (or the palette's default) while a pack picture is still being prepared */
    private fun fallbackScene(v: VisualState): String {
        val sc = assets.allScenes.firstOrNull { it.id == v.sceneId } ?: assets.allScenes.firstOrNull { it.id == "pop" } ?: return ""
        return "asset:www/" + sc.image
    }

    private fun cover(box: RectF, w: Int, h: Int, zoom: Float) {
        val k = maxOf(box.width() / w, box.height() / h) * zoom
        val bw = w * k; val bh = h * k
        dst.set(box.centerX() - bw / 2, box.centerY() - bh / 2, box.centerX() + bw / 2, box.centerY() + bh / 2)
    }

    fun drawCharacter(c: Canvas, box: RectF, v: VisualState, playing: Boolean, bpm: Float, beat: Double, pulse: Float, emote: String?, big: Boolean) {
        val pick = VisualRules.pick(v, playing, bpm, emote)
        if (pick == VisualRules.Pick.None) return
        val H = box.height(); val W = box.width()
        val charH = H * v.charHeight
        r2.set(box.centerX() - charH / 2, box.bottom - charH - H * 0.04f, box.centerX() + charH / 2, box.bottom - H * 0.04f)
        val s0 = min(r2.width(), r2.height()) * 1.02f
        var bmp: Bitmap? = null
        when (pick) {
            is VisualRules.Pick.Loop -> {
                val sh = bitmap(pick.sheet.file, if (big) 1600 else 1100)
                if (sh != null) { val i = VisualRules.frameIndex(beat, bpm, pick.sheet); val r = VisualRules.cell(i, pick.sheet, sh.width, sh.height); src.set(r[0], r[1], r[2], r[3]); bmp = sh }
            }
            is VisualRules.Pick.Still -> bitmap(pick.file, 512)?.let { bmp = it; src.set(0, 0, it.width, it.height) }
            is VisualRules.Pick.BuiltinDance -> assets.dance(pick.tier)?.let { d ->
                val i = VisualRules.frameIndex(beat, bpm, d.asSheet); src.set((i % d.cols) * d.cell, (i / d.cols) * d.cell, (i % d.cols + 1) * d.cell, (i / d.cols + 1) * d.cell); bmp = d.sheet
            }
            is VisualRules.Pick.BuiltinPose -> assets.pose(pick.name)?.let { bmp = it; src.set(0, 0, it.width, it.height) }
            else -> {}
        }
        // a pack sheet still decoding: show built-in Lucielle meanwhile rather than nothing
        if (bmp == null) {
            val d = if (playing) assets.dance(VisualRules.tier(bpm)) else null
            if (d != null) { val i = VisualRules.frameIndex(beat, bpm, d.asSheet); src.set((i % d.cols) * d.cell, (i / d.cols) * d.cell, (i % d.cols + 1) * d.cell, (i / d.cols + 1) * d.cell); bmp = d.sheet }
            else assets.idle()?.let { bmp = it; src.set(0, 0, it.width, it.height) }
        }
        val im = bmp ?: return
        val scale = if (v.charUse == "custom") v.charScale else 1f
        val s = s0 * scale
        val ar = src.width().toFloat() / src.height().coerceAtLeast(1)
        val w = if (ar >= 1) s else s * ar; val h = if (ar >= 1) s / ar else s
        val still = pick is VisualRules.Pick.Still || pick is VisualRules.Pick.BuiltinPose
        val sx = if (playing) 1f + pulse * 0.015f else 1f
        val sy = if (playing) 1f - pulse * 0.025f else 1f + if (still) 0.012f * sin(SystemClock.uptimeMillis() / 700.0).toFloat() else 0f
        val cx = r2.centerX(); val bottom = r2.bottom
        dst.set(cx - w * sx / 2, bottom - h * sy, cx + w * sx / 2, bottom)
        // soft floor shadow
        paint.color = 0x47000000; c.drawOval(cx - charH * 0.2f, bottom - charH * 0.035f - 2, cx + charH * 0.2f, bottom + charH * 0.035f - 2, paint)
        if (v.pixel) {
            // Classic: chunky pixels – Lucielle drawn into a 64 px bitmap and blown up without filtering
            val pb = pixBmp ?: Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).also { pixBmp = it; pixCanvas = Canvas(it) }
            pb.eraseColor(Color.TRANSPARENT)
            val k = 64f / maxOf(dst.width(), dst.height())
            val pw = dst.width() * k; val ph = dst.height() * k
            r3.set(32 - pw / 2, 64 - ph, 32 + pw / 2, 64f); pixCanvas!!.drawBitmap(im, src, r3, bmpPaint)
            val big2 = maxOf(dst.width(), dst.height())
            r3.set(cx - big2 / 2, bottom - big2, cx + big2 / 2, bottom); c.drawBitmap(pb, null, r3, px)
        } else c.drawBitmap(im, src, dst, bmpPaint)
    }

    // ------------------------------------------------------------------ visualizer (page modes: spectrum | scope | both | off)
    private var synthPulse = 0f
    fun drawViz(c: Canvas, area: RectF, mode: String, f: BeatEngine.Frame?, playing: Boolean, a1: Int, a2: Int, pulse: Float = 0f) {
        if (mode == "off") return
        synthPulse = 0.35f + pulse * 0.65f
        if (mode == "spectrum" || mode == "both") drawBars(c, area, f?.mags, playing, a1, a2, if (mode == "both") 0.75f else 1f)
        if (mode == "scope" || mode == "both") drawScope(c, area, f?.wave, playing, a2)
    }
    private fun drawBars(c: Canvas, area: RectF, mags: IntArray?, playing: Boolean, a1: Int, a2: Int, hk: Float) {
        val n = bars.size
        // no live levels (local playback in the floater, or the phone gives no level reader): beat-driven bars
        val live = mags != null && mags.size > 2 && mags.any { it > 0 }
        val t = SystemClock.uptimeMillis() / 1000.0
        for (i in 0 until n) {
            var v = 0f
            if (!live && playing) {
                val shape = 0.55f + 0.45f * sin(i * 0.9 + t * 2.3).toFloat() * sin(i * 0.37 + t * 1.1).toFloat()
                v = (synthPulse * (1f - i / (n * 1.6f)) * shape).coerceIn(0f, 1f)
            } else if (mags != null && playing && mags.size > 2) {
                val lo = Math.pow(mags.size.toDouble(), i.toDouble() / n).toInt().coerceIn(1, mags.size - 1)
                val hi = Math.pow(mags.size.toDouble(), (i + 1.0) / n).toInt().coerceIn(lo + 1, mags.size)
                var m = 0; for (k in lo until hi) if (mags[k] > m) m = mags[k]
                v = m / 255f
            }
            bars[i] = if (v > bars[i]) v else bars[i] * 0.86f
        }
        val bw = area.width() / n
        for (i in 0 until n) {
            val h = bars[i] * area.height() * hk
            paint.color = withAlpha(if (i % 2 == 0) a1 else a2, 170)
            c.drawRoundRect(area.left + i * bw + bw * 0.18f, area.bottom - h, area.left + (i + 1) * bw - bw * 0.18f, area.bottom, bw * 0.3f, bw * 0.3f, paint)
        }
    }
    private val scopePath = Path()
    private fun drawScope(c: Canvas, area: RectF, wave: ByteArray?, playing: Boolean, color: Int) {
        scopePath.reset()
        val live = wave != null && wave.size > 2 && wave.any { (it.toInt() and 0xFF) != 128 && it.toInt() != 0 }
        val t = SystemClock.uptimeMillis() / 1000.0
        val n = 96; val mid = area.centerY(); val amp = area.height() / 2
        for (i in 0..n) {
            val v = when {
                !playing -> 0f
                live -> { val w = wave!!; ((w[(i * (w.size - 1) / n).coerceIn(0, w.size - 1)].toInt() and 0xFF) - 128) / 128f }
                else -> (synthPulse * 0.6f * sin(i * 0.42 + t * 6.0) * sin(i * 0.11 + t * 1.7)).toFloat()
            }
            val x = area.left + area.width() * i / n; val y = mid - v * amp
            if (i == 0) scopePath.moveTo(x, y) else scopePath.lineTo(x, y)
        }
        paint.style = Paint.Style.STROKE; paint.strokeWidth = area.height() * 0.06f; paint.strokeJoin = Paint.Join.ROUND; paint.color = withAlpha(color, 220)
        c.drawPath(scopePath, paint); paint.style = Paint.Style.FILL
    }

    /** bubble: the scene cropped around Lucielle's head, in a circle */
    fun drawHeadBubble(c: Canvas, cx: Float, cy: Float, r: Float, v: VisualState, playing: Boolean, bpm: Float, beat: Double, pulse: Float, emote: String?, square: Boolean = false) {
        val crop = VisualRules.headCrop(v.charHeight)
        // draw the stage so that the crop square fills the circle
        val stage = r * 2 / crop[2]
        val left = cx - r - crop[0] * stage; val top = cy - r - crop[1] * stage
        val box = stageBox.apply { set(left, top, left + stage, top + stage) }
        c.save(); val p = clipPath.apply { reset() }; if (square) p.addRect(cx - r, cy - r, cx + r, cy + r, Path.Direction.CW) else p.addCircle(cx, cy, r, Path.Direction.CW); c.clipPath(p)
        drawBackground(c, box, v, pulse, false)
        drawCharacter(c, box, v, playing, bpm, beat, pulse, emote, false)
        c.restore()
    }

    companion object {
        private val io = Executors.newSingleThreadExecutor()
        fun withAlpha(c: Int, a: Int) = (c and 0xFFFFFF) or (a.coerceIn(0, 255) shl 24)
        fun opaque(c: Int) = c or (0xFF shl 24)
        /** beat pulse 0..1 (decays after each beat) */
        fun pulse(beat: Double, playing: Boolean) = if (playing) exp(-(beat - floor(beat)) * 5.0).toFloat() else 0f
    }
}
