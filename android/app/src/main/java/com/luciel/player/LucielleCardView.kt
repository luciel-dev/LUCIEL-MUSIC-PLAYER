package com.luciel.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.*
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

/**
 * The floating card: scene background, Lucielle dancing on the beat, spectrum bars, track info and transport buttons.
 * Collapsed it becomes a round Lucielle bubble whose halo pulses with the beat.
 */
@SuppressLint("ViewConstructor")
class LucielleCardView(ctx: Context, private val assets: LucielleAssets, private val host: Host) : View(ctx), Choreographer.FrameCallback {
    interface Host {
        fun onDrag(dx: Int, dy: Int)
        fun onDragEnd()
        fun onResize(dw: Int)
        fun onResizeEnd()
        fun onOpenApp()
        fun onSettings()
        fun onCollapse(collapsed: Boolean)
        fun onClose()
    }

    var collapsed = false
        set(v) { field = v; requestLayout(); invalidate() }
    var track: ExtTrack? = null
        set(v) { field = v; invalidate(); ensureTicking() }
    var sceneId = "auto"

    private val dp = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
    private val sub = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xCCFFFFFF.toInt() }
    private val rect = RectF(); private val src = Rect(); private val dst = RectF()
    private val clip = Path()
    private var ticking = false
    private var lastDraw = 0L
    private var frame: BeatEngine.Frame? = null
    private val bars = FloatArray(24)

    // hit boxes (view coords)
    private val btnPrev = RectF(); private val btnPlay = RectF(); private val btnNext = RectF()
    private val btnCollapse = RectF(); private val btnClose = RectF(); private val btnTempo = RectF(); private val handle = RectF()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        if (collapsed) setMeasuredDimension(w, w) else setMeasuredDimension(w, (w * 1.32f).toInt())
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); ensureTicking() }
    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); ticking = false; Choreographer.getInstance().removeFrameCallback(this) }

    private fun ensureTicking() { if (!ticking && isAttachedToWindow) { ticking = true; Choreographer.getInstance().postFrameCallback(this) } }

    override fun doFrame(frameTimeNanos: Long) {
        if (!isAttachedToWindow) { ticking = false; return }
        val now = SystemClock.uptimeMillis()
        val playing = track?.playing == true
        val interval = if (playing) 33 else 120          // ~30 fps dancing, ~8 fps idle breathing
        if (now - lastDraw >= interval) { lastDraw = now; frame = NowPlayingHub.beats.frame(); invalidate() }
        Choreographer.getInstance().postFrameCallback(this)
    }

    // ------------------------------------------------------------------ drawing
    override fun onDraw(c: Canvas) {
        val W = width.toFloat(); val H = height.toFloat()
        val t = track; val f = frame
        val now = SystemClock.uptimeMillis()
        val playing = t?.playing == true
        val beat = f?.beat ?: 0.0
        val ph = beat - floor(beat)
        val pulse = if (playing) Math.exp(-ph * 5.0).toFloat() else 0f
        val accent = t?.tint?.accent ?: 0xFF6CC8FF.toInt()
        val accent2 = t?.tint?.accent2 ?: 0xFFB7E2FF.toInt()
        if (collapsed) { drawBubble(c, W, accent, pulse, playing); return }

        val r = 22 * dp
        clip.reset(); rect.set(0f, 0f, W, H); clip.addRoundRect(rect, r, r, Path.Direction.CW)
        c.save(); c.clipPath(clip)
        // scene background (slight beat zoom)
        val scene = resolveScene(t)
        val bg = assets.sceneArt(scene, W > 260 * dp)
        if (bg != null) {
            val z = 1.08f + pulse * 0.025f
            val s = maxOf(W / bg.width, H / bg.height) * z
            val bw = bg.width * s; val bh = bg.height * s
            dst.set((W - bw) / 2, (H - bh) / 2 - 6 * dp, (W + bw) / 2, (H + bh) / 2 - 6 * dp)
            paint.alpha = 255; c.drawBitmap(bg, null, dst, paint)
        } else { paint.color = t?.tint?.bgDark ?: 0xFF1B2A3A.toInt(); c.drawRect(rect, paint) }
        // bass glow
        val bass = f?.bass ?: 0f
        val sh = shades(W, H, accent)
        paint.shader = sh.glow; paint.alpha = (70 + 150 * (bass + pulse * 0.4f).coerceAtMost(1f)).toInt().coerceIn(0, 255)
        c.drawRect(rect, paint); paint.shader = null; paint.alpha = 255
        // spectrum bars
        drawBars(c, W, H, f, accent, accent2, playing)
        // Lucielle
        drawLucielle(c, W, H, t, f, pulse, playing, now)
        // top + bottom shades for legibility
        paint.shader = sh.top; c.drawRect(0f, 0f, W, H * 0.26f, paint)
        paint.shader = sh.bottom; c.drawRect(0f, H * 0.7f, W, H, paint)
        paint.shader = null
        drawHeader(c, W, t)
        drawControls(c, W, H, t, f, accent)
        c.restore()
        // glossy rim
        paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.5f * dp; paint.color = withAlpha(accent, 150 + (100 * pulse).toInt())
        rect.inset(dp, dp); c.drawRoundRect(rect, r, r, paint); paint.style = Paint.Style.FILL
    }

    private fun resolveScene(t: ExtTrack?): String {
        if (sceneId != "auto") return sceneId
        val f = frame
        return SceneGuess.sceneFor(t?.genre, t?.tint?.family ?: "aero", f?.bpm ?: 0f, f?.energy ?: 0f)
    }

    /** gradients only change with the card size / accent colour: build them once, not every frame */
    private class Shades(val w: Float, val h: Float, val accent: Int, val glow: Shader, val top: Shader, val bottom: Shader)
    private var shadeCache: Shades? = null
    private fun shades(W: Float, H: Float, accent: Int): Shades {
        shadeCache?.let { if (it.w == W && it.h == H && it.accent == accent) return it }
        return Shades(W, H, accent,
            RadialGradient(W / 2, H * 0.62f, W * 0.7f, intArrayOf(withAlpha(accent, 255), Color.TRANSPARENT), null, Shader.TileMode.CLAMP),
            LinearGradient(0f, 0f, 0f, H * 0.26f, 0xAA000000.toInt(), Color.TRANSPARENT, Shader.TileMode.CLAMP),
            LinearGradient(0f, H * 0.7f, 0f, H, Color.TRANSPARENT, 0xCC000000.toInt(), Shader.TileMode.CLAMP)).also { shadeCache = it }
    }

    private fun drawBars(c: Canvas, W: Float, H: Float, f: BeatEngine.Frame?, a1: Int, a2: Int, playing: Boolean) {
        val n = bars.size
        val mags = f?.mags
        for (i in 0 until n) {
            var v = 0f
            if (mags != null && playing) {
                val lo = (Math.pow(mags.size.toDouble(), i.toDouble() / n) ).toInt().coerceIn(1, mags.size - 1)
                val hi = (Math.pow(mags.size.toDouble(), (i + 1.0) / n)).toInt().coerceIn(lo + 1, mags.size)
                var m = 0; for (k in lo until hi) if (mags[k] > m) m = mags[k]
                v = m / 255f
            }
            bars[i] = if (v > bars[i]) v else bars[i] * 0.86f
        }
        val bw = W / n; val base = H * 0.8f; val maxH = H * 0.24f
        for (i in 0 until n) {
            val h = bars[i] * maxH
            paint.color = withAlpha(if (i % 2 == 0) a1 else a2, 150)
            c.drawRoundRect(i * bw + bw * 0.2f, base - h, (i + 1) * bw - bw * 0.2f, base, bw * 0.3f, bw * 0.3f, paint)
        }
    }

    private fun drawLucielle(c: Canvas, W: Float, H: Float, t: ExtTrack?, f: BeatEngine.Frame?, pulse: Float, playing: Boolean, now: Long) {
        val size = min(W * 0.86f, H * 0.62f)
        val cx = W / 2; val bottom = H * 0.83f
        if (playing && f != null) {
            val d = assets.dance(SceneGuess.tier(f.bpm)) ?: return
            val pos = ((f.beat / d.loopBeats) % 1.0 + 1.0) % 1.0
            val idx = (pos * d.frames).toInt().coerceIn(0, d.frames - 1)
            val col = idx % d.cols; val row = idx / d.cols
            src.set(col * d.cell, row * d.cell, (col + 1) * d.cell, (row + 1) * d.cell)
            val s = size * (1f + pulse * 0.03f)
            dst.set(cx - s / 2, bottom - s, cx + s / 2, bottom)
            paint.alpha = 255; c.drawBitmap(d.sheet, src, dst, paint)
        } else {
            val im = assets.idle() ?: return
            val breathe = 1f + 0.012f * sin(now / 700.0).toFloat()
            val s = size * 0.92f
            dst.set(cx - s / 2, bottom - s * breathe, cx + s / 2, bottom)
            paint.alpha = 255; c.drawBitmap(im, null, dst, paint)   // fully opaque, like the dance frames
        }
    }

    private fun drawHeader(c: Canvas, W: Float, t: ExtTrack?) {
        val pad = 12 * dp
        val art = NowPlayingHub.artBitmap
        val aw = 34 * dp
        var x = pad
        if (art != null) {
            dst.set(pad, pad, pad + aw, pad + aw)
            c.save(); clip.reset(); clip.addRoundRect(dst, 8 * dp, 8 * dp, Path.Direction.CW); c.clipPath(clip); c.drawBitmap(art, null, dst, paint); c.restore()
            x += aw + 8 * dp
        }
        // collapse + close buttons
        val bs = 24 * dp
        btnClose.set(W - pad - bs, pad, W - pad, pad + bs)
        btnCollapse.set(btnClose.left - bs - 6 * dp, pad, btnClose.left - 6 * dp, pad + bs)
        circle(c, btnCollapse, 0x55000000); circle(c, btnClose, 0x55000000)
        paint.color = Color.WHITE; paint.strokeWidth = 2 * dp; paint.strokeCap = Paint.Cap.ROUND
        c.drawLine(btnCollapse.centerX() - 6 * dp, btnCollapse.centerY(), btnCollapse.centerX() + 6 * dp, btnCollapse.centerY(), paint)
        val k = 5 * dp
        c.drawLine(btnClose.centerX() - k, btnClose.centerY() - k, btnClose.centerX() + k, btnClose.centerY() + k, paint)
        c.drawLine(btnClose.centerX() + k, btnClose.centerY() - k, btnClose.centerX() - k, btnClose.centerY() + k, paint)
        val tw = btnCollapse.left - 6 * dp - x
        text.textSize = 13 * dp; sub.textSize = 11 * dp
        val title = t?.title?.ifBlank { null } ?: "Nothing playing"
        val artist = listOfNotNull(t?.artist?.ifBlank { null }, t?.appLabel).joinToString(" · ")
        c.drawText(TextUtils.ellipsize(title, text, tw, TextUtils.TruncateAt.END).toString(), x, pad + 14 * dp, text)
        c.drawText(TextUtils.ellipsize(artist, sub, tw, TextUtils.TruncateAt.END).toString(), x, pad + 30 * dp, sub)
    }

    private fun drawControls(c: Canvas, W: Float, H: Float, t: ExtTrack?, f: BeatEngine.Frame?, accent: Int) {
        val cy = H - 30 * dp; val s = 36 * dp; val big = 46 * dp
        btnPlay.set(W / 2 - big / 2, cy - big / 2, W / 2 + big / 2, cy + big / 2)
        btnPrev.set(btnPlay.left - 14 * dp - s, cy - s / 2, btnPlay.left - 14 * dp, cy + s / 2)
        btnNext.set(btnPlay.right + 14 * dp, cy - s / 2, btnPlay.right + 14 * dp + s, cy + s / 2)
        circle(c, btnPrev, 0x66000000); circle(c, btnNext, 0x66000000); circle(c, btnPlay, accent)
        paint.color = Color.WHITE
        val playing = t?.playing == true
        tri(c, btnNext.centerX() - 2 * dp, btnNext.centerY(), 7 * dp, true); c.drawRect(btnNext.centerX() + 5 * dp, btnNext.centerY() - 7 * dp, btnNext.centerX() + 7.5f * dp, btnNext.centerY() + 7 * dp, paint)
        tri(c, btnPrev.centerX() + 2 * dp, btnPrev.centerY(), 7 * dp, false); c.drawRect(btnPrev.centerX() - 7.5f * dp, btnPrev.centerY() - 7 * dp, btnPrev.centerX() - 5 * dp, btnPrev.centerY() + 7 * dp, paint)
        if (playing) {
            c.drawRoundRect(btnPlay.centerX() - 8 * dp, btnPlay.centerY() - 9 * dp, btnPlay.centerX() - 2.5f * dp, btnPlay.centerY() + 9 * dp, 2 * dp, 2 * dp, paint)
            c.drawRoundRect(btnPlay.centerX() + 2.5f * dp, btnPlay.centerY() - 9 * dp, btnPlay.centerX() + 8 * dp, btnPlay.centerY() + 9 * dp, 2 * dp, 2 * dp, paint)
        } else tri(c, btnPlay.centerX() + 2 * dp, btnPlay.centerY(), 10 * dp, true)
        // tempo chip (tap = tap tempo). Shows where the beat comes from.
        sub.textSize = 10 * dp
        val label = when (f?.source) { "live" -> "♪ ${f.bpm.toInt()} live"; "tap" -> "♪ ${f.bpm.toInt()} tap"; else -> "♪ ${(f?.bpm ?: 120f).toInt()} tap me" }
        val lw = sub.measureText(label) + 14 * dp
        btnTempo.set(12 * dp, H - 74 * dp, 12 * dp + lw, H - 56 * dp)
        paint.color = 0x77000000; c.drawRoundRect(btnTempo, 9 * dp, 9 * dp, paint)
        c.drawText(label, btnTempo.left + 7 * dp, btnTempo.bottom - 5 * dp, sub)
        // resize handle (bottom-right corner)
        handle.set(W - 28 * dp, H - 28 * dp, W, H)
        paint.color = 0x99FFFFFF.toInt(); paint.strokeWidth = 1.6f * dp
        for (i in 1..3) c.drawLine(W - 6 * dp - i * 5 * dp, H - 6 * dp, W - 6 * dp, H - 6 * dp - i * 5 * dp, paint)
    }

    private fun drawBubble(c: Canvas, W: Float, accent: Int, pulse: Float, playing: Boolean) {
        val cx = W / 2; val r = W / 2 - 4 * dp
        paint.color = withAlpha(accent, (90 + 140 * pulse).toInt()); c.drawCircle(cx, cx, r + 3 * dp * pulse, paint)
        val ic = assets.icon()
        if (ic != null) { val s = r * 2 * (1f + 0.04f * pulse); dst.set(cx - s / 2, cx - s / 2, cx + s / 2, cx + s / 2); c.drawBitmap(ic, null, dst, paint) }
        if (!playing) { paint.color = 0x88000000.toInt(); c.drawCircle(cx, cx, r * 0.36f, paint); paint.color = Color.WHITE; tri(c, cx + 2 * dp, cx, r * 0.22f, true) }
    }

    private fun circle(c: Canvas, b: RectF, color: Int) { paint.color = color; c.drawCircle(b.centerX(), b.centerY(), b.width() / 2, paint) }
    private fun tri(c: Canvas, x: Float, y: Float, s: Float, right: Boolean) {
        val p = Path(); if (right) { p.moveTo(x - s * 0.7f, y - s); p.lineTo(x + s * 0.8f, y); p.lineTo(x - s * 0.7f, y + s) } else { p.moveTo(x + s * 0.7f, y - s); p.lineTo(x - s * 0.8f, y); p.lineTo(x + s * 0.7f, y + s) }
        p.close(); c.drawPath(p, paint)
    }
    private fun withAlpha(c: Int, a: Int) = (c and 0xFFFFFF) or (a.coerceIn(0, 255) shl 24)

    // ------------------------------------------------------------------ touch
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private var downX = 0f; private var downY = 0f; private var lastX = 0f; private var lastY = 0f
    private var moved = false; private var resizing = false; private var longPressed = false
    private val longPress = Runnable { if (!moved) { longPressed = true; performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS); host.onSettings() } }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.rawX; downY = e.rawY; lastX = downX; lastY = downY; moved = false; longPressed = false
                resizing = !collapsed && handle.contains(e.x, e.y)
                postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
            }
            MotionEvent.ACTION_MOVE -> {
                if (!moved && (abs(e.rawX - downX) > slop || abs(e.rawY - downY) > slop)) { moved = true; removeCallbacks(longPress) }
                if (moved) {
                    val dx = (e.rawX - lastX).toInt(); val dy = (e.rawY - lastY).toInt()
                    if (resizing) host.onResize(dx) else host.onDrag(dx, dy)
                    lastX = e.rawX; lastY = e.rawY
                }
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longPress)
                if (moved) { if (resizing) host.onResizeEnd() else host.onDragEnd() }
                else if (!longPressed) click(e.x, e.y)
            }
            MotionEvent.ACTION_CANCEL -> removeCallbacks(longPress)
        }
        return true
    }

    private fun click(x: Float, y: Float) {
        if (collapsed) { host.onCollapse(false); return }
        when {
            btnPlay.contains(x, y) -> NowPlayingHub.playPause()
            btnNext.contains(x, y) -> NowPlayingHub.next()
            btnPrev.contains(x, y) -> NowPlayingHub.prev()
            btnCollapse.contains(x, y) -> host.onCollapse(true)
            btnClose.contains(x, y) -> host.onClose()
            btnTempo.contains(x, y) -> { NowPlayingHub.beats.tap(); performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP) }
            else -> host.onOpenApp()
        }
        invalidate()
    }
}
