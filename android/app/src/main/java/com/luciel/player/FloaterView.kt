package com.luciel.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

/**
 * Luciel's own floating mini player (like the desktop mini player): the active scene with a tempo-synced dancing
 * Lucielle, cover / title / artist, seek bar, prev / play / next. Three modes: compact strip, large art card, bubble.
 * Drawn on a Canvas and themed from the page's palette + skin (Aero: glassy and rounded; Classic: Winamp bevels + LCD).
 */
@SuppressLint("ViewConstructor")
class FloaterView(ctx: Context, private val assets: LucielleAssets, private val host: Host) : View(ctx), Choreographer.FrameCallback {
    interface Host {
        fun onDrag(dx: Int, dy: Int)
        fun onDragEnd()
        fun onResize(dw: Int)
        fun onResizeEnd()
        fun onCommand(cmd: String, arg: Long = 0)
        fun onOpenApp()
        fun onMode(mode: String)
        fun onClose()
    }

    var state: WebState? = null
        set(v) { field = v; invalidate() }
    var mode: String = FloaterGeometry.COMPACT
        set(v) { field = v; requestLayout(); invalidate() }
    var cover: Bitmap? = null
        set(v) { field = v; invalidate() }
    var sceneBitmap: Bitmap? = null
        set(v) { field = v; invalidate() }

    private val dp = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val bmp = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)   // bitmaps: always fully opaque
    private val px = Paint()                                     // nearest-neighbour (Classic pixel look)
    private val text = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val sub = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val fAero: Typeface = font("www/fonts/selawksb.ttf", Typeface.DEFAULT_BOLD)
    private val fAeroSub: Typeface = font("www/fonts/selawk.ttf", Typeface.DEFAULT)
    private val fPixel: Typeface = font("www/fonts/Silkscreen-Regular.ttf", Typeface.MONOSPACE)
    private val fVt: Typeface = font("www/fonts/VT323-Regular.ttf", Typeface.MONOSPACE)
    private fun font(path: String, fb: Typeface) = try { Typeface.createFromAsset(context.assets, path) } catch (_: Throwable) { fb }

    private val rect = RectF(); private val dst = RectF(); private val src = Rect(); private val clip = Path(); private val tmp = Path()
    // hit areas (filled while drawing)
    private val bPrev = RectF(); private val bPlay = RectF(); private val bNext = RectF()
    private val bMode = RectF(); private val bCollapse = RectF(); private val bClose = RectF()
    private val bSeek = RectF(); private val bHandle = RectF(); private val bOpen = RectF()
    private var seekX0 = 0f; private var seekX1 = 0f
    private var seeking = false; private var seekPreview = -1L
    // Classic: Lucielle drawn into a tiny bitmap and blown up without filtering = pixel art
    private var pixBmp: Bitmap? = null; private var pixCanvas: Canvas? = null

    private var ticking = false; private var lastDraw = 0L

    init { px.isFilterBitmap = false; px.isAntiAlias = false; isHapticFeedbackEnabled = true; contentDescription = "Luciel mini player" }

    val classic get() = state?.theme?.classic == true

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val h = (FloaterGeometry.heightDp(mode, w / dp, classic) * dp).toInt()
        setMeasuredDimension(w, if (mode == FloaterGeometry.BUBBLE) w else h)
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); ensureTicking() }
    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); ticking = false; Choreographer.getInstance().removeFrameCallback(this) }
    private fun ensureTicking() { if (!ticking && isAttachedToWindow) { ticking = true; Choreographer.getInstance().postFrameCallback(this) } }

    override fun doFrame(frameTimeNanos: Long) {
        if (!isAttachedToWindow) { ticking = false; return }
        val now = SystemClock.uptimeMillis()
        val playing = state?.playing == true
        val interval = when { playing && mode != FloaterGeometry.BUBBLE -> 33L; playing -> 50L; else -> 125L }
        if (now - lastDraw >= interval) { lastDraw = now; invalidate() }
        Choreographer.getInstance().postFrameCallback(this)
    }

    // ------------------------------------------------------------------ beat
    private fun beatNow(s: WebState?): Double {
        if (s == null) return 0.0
        if (s.bpm > 0f) return s.beatNow()
        // no tempo yet: a calm 110 bpm clock so she still moves
        return if (s.playing) SystemClock.elapsedRealtime() / 1000.0 * 110 / 60 else 0.0
    }

    // ------------------------------------------------------------------ drawing
    override fun onDraw(c: Canvas) {
        val s = state; val th = s?.theme ?: FloaterTheme()
        val W = width.toFloat(); val H = height.toFloat()
        val playing = s?.playing == true && !s.buffering
        val beat = beatNow(s); val ph = beat - floor(beat)
        val pulse = if (playing) exp(-ph * 5.0).toFloat() else 0f
        when (mode) {
            FloaterGeometry.BUBBLE -> drawBubble(c, W, th, pulse, s)
            FloaterGeometry.LARGE -> drawLarge(c, W, H, th, s, beat, pulse)
            else -> drawCompact(c, W, H, th, s, beat, pulse)
        }
    }

    private fun drawFace(c: Canvas, W: Float, H: Float, th: FloaterTheme, pulse: Float, r: Float) {
        rect.set(0f, 0f, W, H)
        if (th.classic) {
            paint.shader = null; paint.color = th.frame2; c.drawRect(rect, paint)
            bevel(c, rect, th, raised = true, w = 2 * dp)
            return
        }
        paint.color = Color.BLACK; paint.shader = LinearGradient(0f, 0f, 0f, H, opaque(th.bg), opaque(th.bg3), Shader.TileMode.CLAMP)
        c.drawRoundRect(rect, r, r, paint)
        // glass highlight on the top half
        paint.color = Color.BLACK; paint.shader = LinearGradient(0f, 0f, 0f, H * 0.5f, 0x38FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP)
        c.drawRoundRect(rect, r, r, paint); paint.shader = null
        paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.4f * dp; paint.color = withAlpha(th.accent, 120 + (110 * pulse).toInt())
        rect.inset(0.7f * dp, 0.7f * dp); c.drawRoundRect(rect, r, r, paint); paint.style = Paint.Style.FILL
    }

    private fun drawCompact(c: Canvas, W: Float, H: Float, th: FloaterTheme, s: WebState?, beat: Double, pulse: Float) {
        val r = 18 * dp
        drawFace(c, W, H, th, pulse, r)
        val pad = 8 * dp
        var top = pad
        if (th.classic) { drawTitleBar(c, W, th); top = 22 * dp + 4 * dp }
        else headerButtons(c, W - pad, pad, th, overStage = false)
        val st = H - pad - top
        // stage square (scene + Lucielle) with the cover in its corner
        rect.set(pad, top, pad + st, top + st)
        drawStage(c, rect, if (th.classic) 0f else 12 * dp, th, s, beat, pulse)
        bOpen.set(rect)
        drawCoverChip(c, rect.left + 5 * dp, rect.bottom - 5 * dp - 30 * dp, 30 * dp, th)
        val x0 = rect.right + 10 * dp; val x1 = W - pad
        // text: Aero = plain text on glass, Classic = green-screen LCD
        val titleRight = if (th.classic) x1 else bMode.left - 4 * dp
        if (th.classic) {
            dst.set(x0, top, x1, top + 34 * dp); lcd(c, dst, th)
            textInLcd(c, dst, s, th, titleSize = 9.5f, subSize = 15f)
        } else {
            bOpen.union(x0, top, titleRight, top + 34 * dp)
            text.typeface = fAero; text.textSize = 13.5f * dp; text.color = th.text
            sub.typeface = fAeroSub; sub.textSize = 11.5f * dp; sub.color = withAlpha(th.text, 190)
            c.drawText(ell(s?.title?.ifBlank { null } ?: "Luciel", text, titleRight - x0), x0, top + 14 * dp, text)
            c.drawText(ell(s?.artist?.ifBlank { null } ?: if (s?.hasTrack == true) "Unknown artist" else "Nothing playing", sub, x1 - x0), x0, top + 30 * dp, sub)
        }
        // seek
        val sy = top + 46 * dp
        seekBar(c, x0, x1, sy, th, s, showTimes = false)
        // transport
        val cy = H - pad - (if (th.classic) 15 else 19) * dp
        transport(c, x0, cy, if (th.classic) 30 * dp else 34 * dp, if (th.classic) 38 * dp else 40 * dp, th, s, centered = false, x1 = x1 - 22 * dp)
        tempoChip(c, bNext.right + 8 * dp, cy, th, s, x1 - 24 * dp)
        handle(c, W, H, th)
    }

    private fun drawLarge(c: Canvas, W: Float, H: Float, th: FloaterTheme, s: WebState?, beat: Double, pulse: Float) {
        val r = 22 * dp
        drawFace(c, W, H, th, pulse, r)
        var top = 0f
        val stH = FloaterGeometry.stageHeightDp(W / dp) * dp
        if (th.classic) {
            drawTitleBar(c, W, th); top = 22 * dp
            rect.set(6 * dp, top, W - 6 * dp, top + stH - 6 * dp)
            drawStage(c, rect, 0f, th, s, beat, pulse)
        } else {
            rect.set(0f, 0f, W, stH)
            c.save(); clip.reset(); clip.addRoundRect(rect, floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f), Path.Direction.CW); c.clipPath(clip)
            drawStage(c, rect, 0f, th, s, beat, pulse)
            // top shade so the buttons read on any scene
            paint.color = Color.BLACK; paint.shader = LinearGradient(0f, 0f, 0f, 56 * dp, 0x88000000.toInt(), 0, Shader.TileMode.CLAMP); c.drawRect(0f, 0f, W, 56 * dp, paint); paint.shader = null
            c.restore()
            headerButtons(c, W - 10 * dp, 10 * dp, th, overStage = true)
        }
        bOpen.set(rect)
        // bpm chip on the stage
        if (!th.classic) tempoChip(c, 12 * dp, 10 * dp + 13 * dp, th, s, W / 2, onStage = true)
        val y0 = top + stH + (if (th.classic) 4 else 10) * dp
        val pad = 12 * dp
        val cs = 44 * dp
        drawCoverChip(c, pad, y0, cs, th)
        val x0 = pad + cs + 10 * dp; val x1 = W - pad
        if (th.classic) {
            dst.set(x0, y0, x1, y0 + cs); lcd(c, dst, th)
            textInLcd(c, dst, s, th, titleSize = 10f, subSize = 17f)
        } else {
            text.typeface = fAero; text.textSize = 15 * dp; text.color = th.text
            sub.typeface = fAeroSub; sub.textSize = 12.5f * dp; sub.color = withAlpha(th.text, 190)
            c.drawText(ell(s?.title?.ifBlank { null } ?: "Luciel", text, x1 - x0), x0, y0 + 18 * dp, text)
            c.drawText(ell(listOfNotNull(s?.artist?.ifBlank { null }, s?.album?.ifBlank { null }).joinToString(" · ").ifBlank { "Unknown artist" }, sub, x1 - x0), x0, y0 + 37 * dp, sub)
        }
        bOpen.union(pad, y0, x1, y0 + cs)
        seekBar(c, pad, W - pad, y0 + cs + 18 * dp, th, s, showTimes = true)
        val cy = H - 34 * dp
        transport(c, W / 2, cy, 44 * dp, 56 * dp, th, s, centered = true, x1 = W)
        handle(c, W, H, th)
    }

    private fun drawBubble(c: Canvas, W: Float, th: FloaterTheme, pulse: Float, s: WebState?) {
        val cx = W / 2; val r = W / 2 - 4 * dp
        val art = cover ?: assets.icon()
        if (th.classic) {
            rect.set(2 * dp, 2 * dp, W - 2 * dp, W - 2 * dp)
            paint.color = th.frame2; c.drawRect(rect, paint); bevel(c, rect, th, true, 2 * dp)
            dst.set(rect.left + 5 * dp, rect.top + 5 * dp, rect.right - 5 * dp, rect.bottom - 5 * dp)
            if (art != null) c.drawBitmap(art, null, dst, bmp)
            paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * dp; paint.color = withAlpha(th.accent, 120 + (130 * pulse).toInt()); c.drawRect(dst, paint); paint.style = Paint.Style.FILL
        } else {
            paint.color = Color.BLACK; paint.shader = RadialGradient(cx, cx, r + 4 * dp, intArrayOf(withAlpha(th.accent, (120 + 120 * pulse).toInt()), withAlpha(th.accent, 0)), floatArrayOf(0.7f, 1f), Shader.TileMode.CLAMP)
            c.drawCircle(cx, cx, r + 4 * dp, paint); paint.shader = null
            paint.color = opaque(th.bg); c.drawCircle(cx, cx, r, paint)
            if (art != null) {
                val k = r * (0.94f + 0.03f * pulse)
                c.save(); clip.reset(); clip.addCircle(cx, cx, k, Path.Direction.CW); c.clipPath(clip)
                dst.set(cx - k, cx - k, cx + k, cx + k); c.drawBitmap(art, null, dst, bmp); c.restore()
            }
            paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * dp; paint.color = withAlpha(th.accent, 220); c.drawCircle(cx, cx, r, paint); paint.style = Paint.Style.FILL
        }
        if (s?.playing != true) { paint.color = 0x99000000.toInt(); c.drawCircle(cx, cx, r * 0.38f, paint); paint.color = Color.WHITE; tri(c, cx + 2 * dp, cx, r * 0.2f, true) }
    }

    // stage: scene art (beat zoom), accent glow, Lucielle dancing on the beat
    private fun drawStage(c: Canvas, box: RectF, radius: Float, th: FloaterTheme, s: WebState?, beat: Double, pulse: Float) {
        c.save(); clip.reset()
        if (radius > 0) clip.addRoundRect(box, radius, radius, Path.Direction.CW) else clip.addRect(box, Path.Direction.CW)
        c.clipPath(clip)
        val pixelScene = s?.sceneId?.startsWith("pixel") == true || th.classic
        val bg = sceneBitmap ?: assets.sceneArt(s?.sceneId?.ifBlank { null } ?: "pop", box.width() > 200 * dp)
        if (bg != null) {
            val z = 1.06f + pulse * 0.025f
            val k = maxOf(box.width() / bg.width, box.height() / bg.height) * z
            val bw = bg.width * k; val bh = bg.height * k
            dst.set(box.centerX() - bw / 2, box.centerY() - bh / 2, box.centerX() + bw / 2, box.centerY() + bh / 2)
            c.drawBitmap(bg, null, dst, if (pixelScene && s?.sceneId?.startsWith("pixel") == true) px else bmp)
        } else { paint.color = opaque(th.bg3); c.drawRect(box, paint) }
        paint.color = Color.BLACK; paint.shader = RadialGradient(box.centerX(), box.bottom - box.height() * 0.3f, box.width() * 0.7f, intArrayOf(withAlpha(th.accent, (40 + 120 * pulse).toInt()), 0), null, Shader.TileMode.CLAMP)
        c.drawRect(box, paint); paint.shader = null
        if (s?.mascotOn != false) drawLucielle(c, box, th, s, beat, pulse)
        c.restore()
        if (th.classic) bevel(c, box, th, raised = false, w = 2 * dp)
    }

    private fun drawLucielle(c: Canvas, box: RectF, th: FloaterTheme, s: WebState?, beat: Double, pulse: Float) {
        val size = min(box.width() * 0.96f, box.height() * 0.94f)
        val cx = box.centerX(); val bottom = box.bottom + size * 0.02f
        val playing = s?.playing == true && s.buffering.not()
        var sheet: Bitmap? = null
        if (playing) {
            val d = assets.dance(SceneGuess.tier(s?.bpm ?: 0f))
            if (d != null) {
                val pos = ((beat / d.loopBeats) % 1.0 + 1.0) % 1.0
                val idx = (pos * d.frames).toInt().coerceIn(0, d.frames - 1)
                src.set((idx % d.cols) * d.cell, (idx / d.cols) * d.cell, (idx % d.cols + 1) * d.cell, (idx / d.cols + 1) * d.cell)
                sheet = d.sheet
            }
        }
        val im = sheet ?: assets.idle() ?: return
        if (sheet == null) src.set(0, 0, im.width, im.height)
        val breathe = if (playing) 1f + pulse * 0.03f else 1f + 0.012f * sin(SystemClock.uptimeMillis() / 700.0).toFloat()
        val sz = size * breathe
        dst.set(cx - sz / 2, bottom - sz, cx + sz / 2, bottom)
        if (th.classic) {
            // chunky pixels: 64 px canvas blown up with nearest-neighbour
            val pb = pixBmp ?: Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).also { pixBmp = it; pixCanvas = Canvas(it) }
            pb.eraseColor(Color.TRANSPARENT)
            pixCanvas!!.drawBitmap(im, src, Rect(0, 0, 64, 64), bmp)
            c.drawBitmap(pb, null, dst, px)
        } else c.drawBitmap(im, src, dst, bmp)
    }

    private fun drawCoverChip(c: Canvas, x: Float, y: Float, size: Float, th: FloaterTheme) {
        val art = cover ?: return
        dst.set(x, y, x + size, y + size)
        if (th.classic) { c.drawBitmap(art, null, dst, bmp); bevel(c, dst, th, raised = false, w = 1.5f * dp); return }
        c.save(); tmp.reset(); tmp.addRoundRect(dst, 7 * dp, 7 * dp, Path.Direction.CW); c.clipPath(tmp); c.drawBitmap(art, null, dst, bmp); c.restore()
        paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.2f * dp; paint.color = 0xCCFFFFFF.toInt(); c.drawRoundRect(dst, 7 * dp, 7 * dp, paint); paint.style = Paint.Style.FILL
    }

    // Classic: a Winamp-ish title bar with tiny beveled buttons
    private fun drawTitleBar(c: Canvas, W: Float, th: FloaterTheme) {
        dst.set(3 * dp, 3 * dp, W - 3 * dp, 21 * dp)
        paint.color = Color.BLACK; paint.shader = LinearGradient(0f, dst.top, 0f, dst.bottom, th.frameDark, darker(th.frameDark), Shader.TileMode.CLAMP); c.drawRect(dst, paint); paint.shader = null
        // stripes
        paint.color = withAlpha(th.accent, 140)
        val bs = 16 * dp; val gap = 3 * dp
        bClose.set(dst.right - 2 * dp - bs, dst.top + 1 * dp, dst.right - 2 * dp, dst.top + 1 * dp + bs)
        bCollapse.set(bClose.left - gap - bs, bClose.top, bClose.left - gap, bClose.bottom)
        bMode.set(bCollapse.left - gap - bs, bClose.top, bCollapse.left - gap, bClose.bottom)
        text.typeface = fPixel; text.textSize = 8.5f * dp; text.color = th.lcdFg
        val label = "LUCIEL"
        val tw = text.measureText(label)
        val tx = 8 * dp
        var x = tx + tw + 6 * dp
        while (x < bMode.left - 6 * dp) { c.drawRect(x, dst.top + 6 * dp, minOf(x + 10 * dp, bMode.left - 6 * dp), dst.top + 7.2f * dp, paint); c.drawRect(x, dst.top + 10 * dp, minOf(x + 10 * dp, bMode.left - 6 * dp), dst.top + 11.2f * dp, paint); x += 12 * dp }
        c.drawText(label, tx, dst.top + 12.5f * dp, text)
        for ((b, g) in listOf(bMode to if (mode == FloaterGeometry.LARGE) "s" else "L", bCollapse to "_", bClose to "x")) {
            paint.color = th.frame2; c.drawRect(b, paint); bevel(c, b, th, raised = true, w = 1.2f * dp)
            paint.color = ink(th); paint.strokeWidth = 1.6f * dp; paint.strokeCap = Paint.Cap.SQUARE
            glyph(c, b, g)
        }
        // generous touch targets around the tiny buttons
        for (b in listOf(bMode, bCollapse, bClose)) b.inset(-4 * dp, -4 * dp)
    }

    // Aero: round translucent buttons (mode / bubble / close)
    private fun headerButtons(c: Canvas, right: Float, top: Float, th: FloaterTheme, overStage: Boolean) {
        val bs = 24 * dp; val gap = 6 * dp
        bClose.set(right - bs, top, right, top + bs)
        bCollapse.set(bClose.left - gap - bs, top, bClose.left - gap, top + bs)
        bMode.set(bCollapse.left - gap - bs, top, bCollapse.left - gap, top + bs)
        val fill = if (overStage) 0x66000000 else withAlpha(th.text, 34)
        val ink = if (overStage) Color.WHITE else th.text
        paint.strokeWidth = 1.8f * dp; paint.strokeCap = Paint.Cap.ROUND
        for ((b, g) in listOf(bMode to if (mode == FloaterGeometry.LARGE) "s" else "L", bCollapse to "_", bClose to "x")) {
            paint.color = fill; c.drawCircle(b.centerX(), b.centerY(), bs / 2, paint)
            paint.color = ink; glyph(c, b, g)
        }
        for (b in listOf(bMode, bCollapse, bClose)) b.inset(-3 * dp, -4 * dp)
    }

    /** "x" close, "_" bubble, "L" bigger art, "s" smaller strip */
    private fun glyph(c: Canvas, b: RectF, g: String) {
        val cx = b.centerX(); val cy = b.centerY(); val k = b.width() * 0.2f
        paint.style = Paint.Style.STROKE
        when (g) {
            "x" -> { c.drawLine(cx - k, cy - k, cx + k, cy + k, paint); c.drawLine(cx + k, cy - k, cx - k, cy + k, paint) }
            "_" -> c.drawLine(cx - k, cy + k * 0.6f, cx + k, cy + k * 0.6f, paint)
            "L" -> { c.drawRect(cx - k, cy - k, cx + k, cy + k, paint) }
            else -> { c.drawRect(cx - k, cy - k * 0.45f, cx + k, cy + k * 0.45f, paint) }
        }
        paint.style = Paint.Style.FILL
    }

    private fun lcd(c: Canvas, b: RectF, th: FloaterTheme) { paint.color = opaque(th.lcdBg); c.drawRect(b, paint); bevel(c, b, th, raised = false, w = 1.5f * dp) }

    private fun textInLcd(c: Canvas, b: RectF, s: WebState?, th: FloaterTheme, titleSize: Float, subSize: Float) {
        val w = b.width() - 10 * dp
        text.typeface = fPixel; text.textSize = titleSize * dp; text.color = th.lcdFg
        sub.typeface = fVt; sub.textSize = subSize * dp; sub.color = withAlpha(th.lcdFg, 200)
        val pos = fmt((if (seeking && seekPreview >= 0) seekPreview else s?.positionNow() ?: 0L))
        val tw = sub.measureText(pos)
        c.drawText(ell((s?.title?.ifBlank { null } ?: "LUCIEL").uppercase(), text, w), b.left + 5 * dp, b.top + titleSize * dp + 4 * dp, text)
        c.drawText(ell(s?.artist?.ifBlank { null } ?: "", sub, w - tw - 6 * dp), b.left + 5 * dp, b.bottom - 4 * dp, sub)
        c.drawText(pos, b.right - 5 * dp - tw, b.bottom - 4 * dp, sub)
    }

    private fun seekBar(c: Canvas, x0: Float, x1: Float, cy: Float, th: FloaterTheme, s: WebState?, showTimes: Boolean) {
        val dur = s?.durationMs?.takeIf { it > 0 && it != androidx.media3.common.C.TIME_UNSET } ?: 0L
        val pos = if (seeking && seekPreview >= 0) seekPreview else s?.positionNow() ?: 0L
        var a = x0; var b = x1
        if (showTimes) {
            sub.typeface = if (th.classic) fVt else fAeroSub; sub.textSize = (if (th.classic) 15f else 11f) * dp; sub.color = if (th.classic) ink(th) else withAlpha(th.text, 200)
            val t0 = fmt(pos); val t1 = if (dur > 0) fmt(dur) else "--:--"
            val w0 = sub.measureText("00:00"); a = x0 + w0 + 8 * dp; b = x1 - w0 - 8 * dp
            c.drawText(t0, x0, cy + 4 * dp, sub); c.drawText(t1, x1 - sub.measureText(t1), cy + 4 * dp, sub)
        }
        seekX0 = a; seekX1 = b
        bSeek.set(a - 8 * dp, cy - 14 * dp, b + 8 * dp, cy + 14 * dp)          // 28 dp tall touch strip
        val f = if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f
        val kx = a + (b - a) * f
        if (th.classic) {
            dst.set(a, cy - 3 * dp, b, cy + 3 * dp); paint.color = darker(th.frameDark); c.drawRect(dst, paint); bevel(c, dst, th, raised = false, w = 1 * dp)
            paint.color = th.accent; c.drawRect(a + 1 * dp, cy - 2 * dp, kx, cy + 2 * dp, paint)
            dst.set(kx - 5 * dp, cy - 6 * dp, kx + 5 * dp, cy + 6 * dp); paint.color = th.frame2; c.drawRect(dst, paint); bevel(c, dst, th, raised = true, w = 1.2f * dp)
        } else {
            paint.color = withAlpha(th.text, 50); c.drawRoundRect(a, cy - 2 * dp, b, cy + 2 * dp, 2 * dp, 2 * dp, paint)
            paint.color = Color.BLACK; paint.shader = LinearGradient(a, 0f, b, 0f, th.accent, th.accent2, Shader.TileMode.CLAMP)
            c.drawRoundRect(a, cy - 2 * dp, kx, cy + 2 * dp, 2 * dp, 2 * dp, paint); paint.shader = null
            paint.color = Color.WHITE; c.drawCircle(kx, cy, (if (seeking) 8 else 6) * dp, paint)
            paint.color = th.accent; c.drawCircle(kx, cy, 3 * dp, paint)
        }
    }

    private fun transport(c: Canvas, x: Float, cy: Float, s: Float, big: Float, th: FloaterTheme, st: WebState?, centered: Boolean, x1: Float) {
        val gap = if (centered) 16 * dp else 8 * dp
        if (th.classic) {
            val h = s * 0.82f; val bw = s * 1.05f; val pw = big * 1.0f
            if (centered) bPlay.set(x - pw / 2, cy - h / 2, x + pw / 2, cy + h / 2) else bPlay.set(x + bw + gap, cy - h / 2, x + bw + gap + pw, cy + h / 2)
            bPrev.set(bPlay.left - gap - bw, cy - h / 2, bPlay.left - gap, cy + h / 2)
            bNext.set(bPlay.right + gap, cy - h / 2, bPlay.right + gap + bw, cy + h / 2)
            for (b in listOf(bPrev, bPlay, bNext)) { paint.color = th.frame2; c.drawRect(b, paint); bevel(c, b, th, raised = true, w = 1.6f * dp) }
            paint.color = ink(th)
        } else {
            if (centered) bPlay.set(x - big / 2, cy - big / 2, x + big / 2, cy + big / 2) else bPlay.set(x + s + gap, cy - big / 2, x + s + gap + big, cy + big / 2)
            bPrev.set(bPlay.left - gap - s, cy - s / 2, bPlay.left - gap, cy + s / 2)
            bNext.set(bPlay.right + gap, cy - s / 2, bPlay.right + gap + s, cy + s / 2)
            paint.color = withAlpha(th.text, 34); c.drawCircle(bPrev.centerX(), cy, s / 2, paint); c.drawCircle(bNext.centerX(), cy, s / 2, paint)
            paint.color = Color.BLACK; paint.shader = LinearGradient(0f, bPlay.top, 0f, bPlay.bottom, th.accent2, th.accent, Shader.TileMode.CLAMP)
            c.drawCircle(bPlay.centerX(), cy, big / 2, paint); paint.shader = null
            paint.color = 0x55FFFFFF; c.drawOval(bPlay.left + big * 0.18f, bPlay.top + big * 0.06f, bPlay.right - big * 0.18f, bPlay.top + big * 0.46f, paint)
            paint.color = th.text
        }
        val g = min(bPrev.height(), bPrev.width()) * 0.2f
        tri(c, bNext.centerX() - g * 0.25f, cy, g, true); c.drawRect(bNext.centerX() + g * 0.75f, cy - g, bNext.centerX() + g * 1.1f, cy + g, paint)
        tri(c, bPrev.centerX() + g * 0.25f, cy, g, false); c.drawRect(bPrev.centerX() - g * 1.1f, cy - g, bPrev.centerX() - g * 0.75f, cy + g, paint)
        if (!th.classic) paint.color = Color.WHITE
        val pg = min(bPlay.height(), bPlay.width()) * 0.2f
        val playing = st?.playing == true
        if (playing) {
            c.drawRect(bPlay.centerX() - pg * 0.9f, cy - pg, bPlay.centerX() - pg * 0.3f, cy + pg, paint)
            c.drawRect(bPlay.centerX() + pg * 0.3f, cy - pg, bPlay.centerX() + pg * 0.9f, cy + pg, paint)
        } else tri(c, bPlay.centerX() + pg * 0.2f, cy, pg, true)
        // make the touch targets at least 44 dp
        for (b in listOf(bPrev, bPlay, bNext)) { val ex = ((44 * dp - b.height()) / 2).coerceAtLeast(0f); b.inset(-2 * dp, -ex) }
        if (st?.buffering == true && playing) { paint.style = Paint.Style.STROKE; paint.strokeWidth = 2 * dp; paint.color = withAlpha(th.accent2, 200); val a = (SystemClock.uptimeMillis() / 3 % 360).toFloat(); dst.set(bPlay); dst.inset(4 * dp, (bPlay.height() - bPlay.width()) / 2 + 4 * dp); c.drawArc(dst, a, 90f, false, paint); paint.style = Paint.Style.FILL }
    }

    private fun tempoChip(c: Canvas, x: Float, cy: Float, th: FloaterTheme, s: WebState?, maxX: Float, onStage: Boolean = false) {
        val bpm = s?.bpm ?: 0f
        if (bpm <= 0f) return
        val label = "♪ ${bpm.toInt()}" + if (onStage) " BPM" else ""
        sub.typeface = if (th.classic) fVt else fAeroSub; sub.textSize = (if (th.classic) 15f else 11f) * dp
        val w = sub.measureText(label) + 12 * dp
        if (x + w > maxX) return
        dst.set(x, cy - 9 * dp, x + w, cy + 9 * dp)
        if (th.classic) { paint.color = opaque(th.lcdBg); c.drawRect(dst, paint); sub.color = th.lcdFg }
        else { paint.color = if (onStage) 0x66000000 else withAlpha(th.text, 30); c.drawRoundRect(dst, 9 * dp, 9 * dp, paint); sub.color = if (onStage) Color.WHITE else th.text }
        c.drawText(label, x + 6 * dp, cy + 4 * dp, sub)
    }

    private fun handle(c: Canvas, W: Float, H: Float, th: FloaterTheme) {
        bHandle.set(W - 26 * dp, H - 26 * dp, W, H)
        paint.color = if (th.classic) ink(th) else withAlpha(th.text, 130); paint.strokeWidth = 1.5f * dp
        for (i in 1..3) c.drawLine(W - 5 * dp - i * 4.5f * dp, H - 5 * dp, W - 5 * dp, H - 5 * dp - i * 4.5f * dp, paint)
    }

    private fun bevel(c: Canvas, b: RectF, th: FloaterTheme, raised: Boolean, w: Float) {
        val lt = if (raised) th.frame1 else th.frameDark; val rb = if (raised) th.frameDark else th.frame1
        paint.color = lt; c.drawRect(b.left, b.top, b.right, b.top + w, paint); c.drawRect(b.left, b.top, b.left + w, b.bottom, paint)
        paint.color = rb; c.drawRect(b.left, b.bottom - w, b.right, b.bottom, paint); c.drawRect(b.right - w, b.top, b.right, b.bottom, paint)
    }

    private fun tri(c: Canvas, x: Float, y: Float, s: Float, right: Boolean) {
        tmp.reset()
        if (right) { tmp.moveTo(x - s * 0.7f, y - s); tmp.lineTo(x + s * 0.8f, y); tmp.lineTo(x - s * 0.7f, y + s) } else { tmp.moveTo(x + s * 0.7f, y - s); tmp.lineTo(x - s * 0.8f, y); tmp.lineTo(x + s * 0.7f, y + s) }
        tmp.close(); c.drawPath(tmp, paint)
    }
    private fun ell(s: String, p: TextPaint, w: Float) = if (w <= 0) "" else TextUtils.ellipsize(s, p, w, TextUtils.TruncateAt.END).toString()
    private fun withAlpha(c: Int, a: Int) = (c and 0xFFFFFF) or (a.coerceIn(0, 255) shl 24)
    /** glyph colour on Classic button faces: dark on light chrome (Aero/Winamp grey), light on the dark palettes */
    private fun ink(th: FloaterTheme): Int { val f = th.frame2; val l = (0.299 * Color.red(f) + 0.587 * Color.green(f) + 0.114 * Color.blue(f)) / 255; return if (l > 0.45) darker(th.frameDark) else opaque(th.text) }
    private fun opaque(c: Int) = c or (0xFF shl 24)
    private fun darker(c: Int) = Color.rgb((Color.red(c) * 0.55f).toInt(), (Color.green(c) * 0.55f).toInt(), (Color.blue(c) * 0.55f).toInt())
    private fun fmt(ms: Long): String { val t = (ms / 1000).coerceAtLeast(0); return "%d:%02d".format(t / 60, t % 60) }

    // ------------------------------------------------------------------ touch
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private var downX = 0f; private var downY = 0f; private var lastX = 0f; private var lastY = 0f
    private var moved = false; private var resizing = false; private var longPressed = false
    private val longPress = Runnable { if (!moved && !seeking && !resizing) { longPressed = true; performHapticFeedback(HapticFeedbackConstants.LONG_PRESS); host.onOpenApp() } }

    private fun seekAt(x: Float): Long {
        val dur = state?.durationMs?.takeIf { it > 0 && it != androidx.media3.common.C.TIME_UNSET } ?: return -1
        return (((x - seekX0) / (seekX1 - seekX0)).coerceIn(0f, 1f) * dur).toLong()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.rawX; downY = e.rawY; lastX = downX; lastY = downY; moved = false; longPressed = false
                resizing = mode != FloaterGeometry.BUBBLE && bHandle.contains(e.x, e.y)
                seeking = mode != FloaterGeometry.BUBBLE && !resizing && bSeek.contains(e.x, e.y) && (state?.durationMs ?: 0) > 0
                if (seeking) { seekPreview = seekAt(e.x); parent?.requestDisallowInterceptTouchEvent(true); invalidate() }
                else if (!resizing) postDelayed(longPress, if (mode == FloaterGeometry.BUBBLE) 450L else 600L)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (seeking) { seekPreview = seekAt(e.x); invalidate(); return true }
                val dx = e.rawX - lastX; val dy = e.rawY - lastY
                if (!moved && (abs(e.rawX - downX) > slop || abs(e.rawY - downY) > slop)) { moved = true; removeCallbacks(longPress) }
                if (moved) {
                    if (resizing) host.onResize(dx.toInt()) else host.onDrag(dx.toInt(), dy.toInt())
                    lastX += dx.toInt(); lastY += dy.toInt()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longPress)
                when {
                    seeking -> { seeking = false; val p = seekAt(e.x); if (p >= 0) host.onCommand("seek", p); seekPreview = -1; invalidate() }
                    resizing -> { resizing = false; if (moved) host.onResizeEnd() }
                    moved -> host.onDragEnd()
                    !longPressed -> click(e.x, e.y)
                }
                return true
            }
            MotionEvent.ACTION_CANCEL -> { removeCallbacks(longPress); if (moved && !resizing) host.onDragEnd(); if (resizing && moved) host.onResizeEnd(); seeking = false; resizing = false; seekPreview = -1 }
        }
        return super.onTouchEvent(e)
    }

    private fun click(x: Float, y: Float) {
        if (mode == FloaterGeometry.BUBBLE) { host.onMode("expand"); return }
        val tap = { performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }
        when {
            bClose.contains(x, y) -> { tap(); host.onClose() }
            bCollapse.contains(x, y) -> { tap(); host.onMode(FloaterGeometry.BUBBLE) }
            bMode.contains(x, y) -> { tap(); host.onMode(if (mode == FloaterGeometry.LARGE) FloaterGeometry.COMPACT else FloaterGeometry.LARGE) }
            bPlay.contains(x, y) -> { tap(); host.onCommand("toggle") }
            bPrev.contains(x, y) -> { tap(); host.onCommand("prev") }
            bNext.contains(x, y) -> { tap(); host.onCommand("next") }
            bOpen.contains(x, y) -> host.onOpenApp()
        }
    }
}
