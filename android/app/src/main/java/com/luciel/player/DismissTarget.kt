package com.luciel.player

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import kotlin.math.hypot

/**
 * Chat-head style "drag here to close" target at the bottom of the screen, shown while a floating window is dragged.
 * Dropping the window's centre inside it closes that window (never the music).
 */
class DismissTarget(private val ctx: Context) {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val dp = ctx.resources.displayMetrics.density
    private var view: TargetView? = null
    var near = false; private set
    private val sizePx = (96 * dp).toInt()

    @SuppressLint("ViewConstructor")
    private inner class TargetView : View(ctx) {
        var hot = false; set(v) { if (field != v) { field = v; if (v) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); invalidate() } }
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(c: Canvas) {
            val cx = width / 2f; val cy = height / 2f; val r = (if (hot) 38 else 30) * dp
            p.style = Paint.Style.FILL; p.color = if (hot) 0xEEE0344B.toInt() else 0xCC1B2230.toInt(); c.drawCircle(cx, cy, r, p)
            p.style = Paint.Style.STROKE; p.strokeWidth = 2 * dp; p.color = 0x99FFFFFF.toInt(); c.drawCircle(cx, cy, r, p)
            p.color = Color.WHITE; p.strokeWidth = 3 * dp; p.strokeCap = Paint.Cap.ROUND
            val k = 9 * dp; c.drawLine(cx - k, cy - k, cx + k, cy + k, p); c.drawLine(cx + k, cy - k, cx - k, cy + k, p)
        }
    }

    private fun bottomInset(): Int = if (Build.VERSION.SDK_INT >= 30) wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars()).bottom else (48 * dp).toInt()
    private fun screen(): Pair<Int, Int> = if (Build.VERSION.SDK_INT >= 30) wm.currentWindowMetrics.bounds.let { it.width() to it.height() } else ctx.resources.displayMetrics.let { it.widthPixels to it.heightPixels }

    fun show() {
        if (view != null) return
        val v = TargetView()
        val p = WindowManager.LayoutParams(sizePx, sizePx, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; y = bottomInset() + (24 * dp).toInt(); title = "Luciel close target"
        }
        try { wm.addView(v, p); view = v } catch (_: Throwable) {}
        near = false
    }

    /** window centre in screen pixels while dragging */
    fun track(cx: Int, cy: Int) {
        val v = view ?: return
        val (w, h) = screen()
        val tx = w / 2f; val ty = h - bottomInset() - 24 * dp - sizePx / 2f
        near = hypot(cx - tx, cy - ty) < 80 * dp
        v.hot = near
    }

    /** hides the target; true when the window was dropped on it */
    fun finish(): Boolean {
        val hit = near; near = false
        view?.let { try { wm.removeView(it) } catch (_: Throwable) {} }
        view = null
        return hit
    }
}
