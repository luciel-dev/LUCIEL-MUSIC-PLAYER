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
        fun onToggleSize()
        fun onOpenPlayer()
        fun onLongPressBubble()
    }

    var collapsed = false
        set(v) { field = v; requestLayout(); invalidate() }
    var track: ExtTrack? = null
        set(v) { field = v; invalidate(); ensureTicking() }
    /** Luciel's current look (scene, outfit, palette, visualizer) – the card mirrors the app's stage */
    var visual: VisualState = VisualHub.current
        set(v) { field = v; invalidate() }
    private val art = VisualArt(assets) { invalidate() }
    private var shownKey: String? = null

    private val dp = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
    private val sub = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xCCFFFFFF.toInt() }
    private val rect = RectF(); private val dst = RectF()
    private val stageBox = RectF(); private val vizBox = RectF()
    private val clip = Path()
    private var ticking = false
    private var lastDraw = 0L
    private var frame: BeatEngine.Frame? = null

    // hit boxes (view coords)
    private val btnPrev = RectF(); private val btnPlay = RectF(); private val btnNext = RectF()
    private val btnSize = RectF(); private val headTap = RectF()
    /** "large" card mode (bigger default width); only changes the size button's icon */
    var large = false; set(v) { field = v; invalidate() }
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
        val playing = t?.playing == true
        val beat = f?.beat ?: 0.0
        val ph = beat - floor(beat)
        val pulse = if (playing) Math.exp(-ph * 5.0).toFloat() else 0f
        val v = stageState(t)
        val accent = if (visual.hasState) VisualArt.opaque(v.theme.accent) else t?.tint?.accent ?: 0xFF6CC8FF.toInt()
        val accent2 = if (visual.hasState) VisualArt.opaque(v.theme.accent2) else t?.tint?.accent2 ?: 0xFFB7E2FF.toInt()
        val bpm = f?.bpm ?: 120f
        val emote = art.emoteNow(v, t?.trackKey, playing, f?.bass ?: 0f, f?.source == "live")
        logShown(t)
        if (collapsed) { drawBubble(c, W, v, accent, pulse, playing, bpm, beat, emote); return }

        val r = 22 * dp
        clip.reset(); rect.set(0f, 0f, W, H); clip.addRoundRect(rect, r, r, Path.Direction.CW)
        c.save(); c.clipPath(clip)
        // the app's stage: same scene picture, light map, Lucielle outfit + emotes, visualizer style
        val bass = f?.bass ?: 0f
        stageBox.set(0f, H * 0.1f, W, H * 0.84f)
        vizBox.set(0f, H * 0.56f, W, H * 0.8f)
        art.drawStage(c, rect, v, playing, bpm, beat, pulse, bass, emote, W > 260 * dp, stageBox) { art.drawViz(c, vizBox, v.vizMode, f, playing, accent, accent2, pulse) }
        val sh = shades(W, H, accent)
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

    /** what to draw: the app's published look, or (before the app has ever published one) a guess from the song */
    private fun stageState(t: ExtTrack?): VisualState {
        if (visual.hasState) return visual
        val f = frame
        return VisualState(sceneId = SceneGuess.sceneFor(t?.genre, t?.tint?.family ?: "aero", f?.bpm ?: 0f, f?.energy ?: 0f))
    }

    /** sync debugging: how long after the media-session event the new song / play state reached the card */
    private fun logShown(t: ExtTrack?) {
        t ?: return
        val k = t.trackKey + "|" + t.playing + "|" + t.artVersion
        if (k == shownKey) return
        shownKey = k
        if (t.eventAt > 0) DebugLog.add("sync", "card: “${t.title.take(40)}” ${if (t.playing) "playing" else "paused"}${if (NowPlayingHub.artBitmap != null) " +cover" else ""} shown ${SystemClock.elapsedRealtime() - t.eventAt} ms after the session event")
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
        // narrow card: the size button sits under the close button so the title keeps its room
        if (W < 230 * dp) btnSize.set(btnClose.left, btnClose.bottom + 6 * dp, btnClose.right, btnClose.bottom + 6 * dp + bs)
        else btnSize.set(btnCollapse.left - bs - 6 * dp, pad, btnCollapse.left - 6 * dp, pad + bs)
        circle(c, btnSize, 0x55000000); circle(c, btnCollapse, 0x55000000); circle(c, btnClose, 0x55000000)
        // size button: two corner arrows (grow) or a smaller square (shrink)
        run {
            paint.color = Color.WHITE; paint.strokeWidth = 1.8f * dp; paint.strokeCap = Paint.Cap.ROUND
            val q = if (large) 3.5f * dp else 5.5f * dp; val cxs = btnSize.centerX(); val cys = btnSize.centerY()
            c.drawLine(cxs - q, cys - q, cxs - q, cys - q + 4 * dp, paint); c.drawLine(cxs - q, cys - q, cxs - q + 4 * dp, cys - q, paint)
            c.drawLine(cxs + q, cys + q, cxs + q, cys + q - 4 * dp, paint); c.drawLine(cxs + q, cys + q, cxs + q - 4 * dp, cys + q, paint)
        }
        paint.color = Color.WHITE; paint.strokeWidth = 2 * dp; paint.strokeCap = Paint.Cap.ROUND
        c.drawLine(btnCollapse.centerX() - 6 * dp, btnCollapse.centerY(), btnCollapse.centerX() + 6 * dp, btnCollapse.centerY(), paint)
        val k = 5 * dp
        c.drawLine(btnClose.centerX() - k, btnClose.centerY() - k, btnClose.centerX() + k, btnClose.centerY() + k, paint)
        c.drawLine(btnClose.centerX() + k, btnClose.centerY() - k, btnClose.centerX() - k, btnClose.centerY() + k, paint)
        val right = if (W < 230 * dp) btnCollapse.left else btnSize.left
        val tw = right - 6 * dp - x
        headTap.set(0f, 0f, right - 3 * dp, pad + 38 * dp)          // cover + title: opens Spotify
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
        val label = TempoLabel.of(f?.bpm ?: 120f, f?.source)
        val lw = sub.measureText(label) + 14 * dp
        btnTempo.set(12 * dp, H - 74 * dp, 12 * dp + lw, H - 56 * dp)
        paint.color = 0x77000000; c.drawRoundRect(btnTempo, 9 * dp, 9 * dp, paint)
        c.drawText(label, btnTempo.left + 7 * dp, btnTempo.bottom - 5 * dp, sub)
        // resize handle (bottom-right corner)
        handle.set(W - 28 * dp, H - 28 * dp, W, H)
        paint.color = 0x99FFFFFF.toInt(); paint.strokeWidth = 1.6f * dp
        for (i in 1..3) c.drawLine(W - 6 * dp - i * 5 * dp, H - 6 * dp, W - 6 * dp, H - 6 * dp - i * 5 * dp, paint)
    }

    private fun drawBubble(c: Canvas, W: Float, v: VisualState, accent: Int, pulse: Float, playing: Boolean, bpm: Float, beat: Double, emote: String?) {
        val cx = W / 2; val r = W / 2 - 4 * dp
        paint.color = withAlpha(accent, (90 + 140 * pulse).toInt()); c.drawCircle(cx, cx, r + 3 * dp * pulse, paint)
        // the app's scene, cropped around Lucielle's head (same outfit); falls back to the app icon if the mascot is off
        if (v.mascot && v.charUse != "none") art.drawHeadBubble(c, cx, cx, r - 2 * dp, v, playing, bpm, beat, pulse, emote)
        else assets.icon()?.let { ic -> val s = r * 2 * (1f + 0.04f * pulse); dst.set(cx - s / 2, cx - s / 2, cx + s / 2, cx + s / 2); c.drawBitmap(ic, null, dst, paint) }
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
    private val longPress = Runnable { if (!moved) { longPressed = true; performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS); if (collapsed) host.onLongPressBubble() else host.onSettings() } }

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
            btnSize.contains(x, y) -> host.onToggleSize()
            headTap.contains(x, y) -> host.onOpenPlayer()
            btnTempo.contains(x, y) -> { NowPlayingHub.beats.tap(); performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP) }
            else -> host.onOpenApp()
        }
        invalidate()
    }
}
