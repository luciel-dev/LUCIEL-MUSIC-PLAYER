package com.luciel.player

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.WindowManager

/**
 * Shows the floating Lucielle card over other apps while an outside player (Spotify by default, or any player) is
 * playing. Needs "Display over other apps" (SYSTEM_ALERT_WINDOW); without it nothing is shown and the in-app
 * Spotify mode still works.
 */
class OverlayController(private val svc: Context) : LucielleCardView.Host {
    private val ctx = ContextThemeWrapper(svc, R.style.Theme_Luciel)
    private val wm = svc.getSystemService(WindowManager::class.java)
    private val prefs = Prefs.get(svc)
    private val main = Handler(Looper.getMainLooper())
    private val assets by lazy { LucielleAssets(svc) }
    private var view: LucielleCardView? = null
    private var lp: WindowManager.LayoutParams? = null
    /** user closed it for this song (comes back on the next song) */
    private var dismissedKey: String? = null
    private val dp = svc.resources.displayMetrics.density
    private val hideRunnable = Runnable { hide() }
    private val listener: (ExtTrack?) -> Unit = { main.post { onTrack(it) } }

    fun start() { NowPlayingHub.listeners.add(listener); onTrack(NowPlayingHub.current); instance = this }
    fun stop() { NowPlayingHub.listeners.remove(listener); main.removeCallbacks(hideRunnable); hide(); if (instance === this) instance = null }

    fun canShow() = Settings.canDrawOverlays(svc)

    private fun onTrack(t: ExtTrack?) {
        val v = view
        if (t == null) { main.removeCallbacks(hideRunnable); hide(); return }
        if (dismissedKey != null && dismissedKey != t.trackKey) dismissedKey = null
        val want = prefs.overlayEnabled && canShow() && !appInFront && dismissedKey == null
        if (t.playing) {
            main.removeCallbacks(hideRunnable)
            if (want && v == null) show()
        } else if (v != null && prefs.autoHideSec > 0) {
            main.removeCallbacks(hideRunnable); main.postDelayed(hideRunnable, prefs.autoHideSec * 1000L)
        }
        if (!want && v != null && (appInFront || !prefs.overlayEnabled)) hide()
        view?.track = t
    }

    /** settings changed / app went to background */
    fun refresh() { main.post { view?.sceneId = prefs.overlayScene; view?.alpha = prefs.overlayOpacity / 100f; applySize(); onTrack(NowPlayingHub.current) } }

    private fun widthPx() = if (view?.collapsed == true) (64 * dp).toInt() else (prefs.overlaySizeDp * dp).toInt()

    private fun show() {
        if (view != null || !canShow()) return
        val v = LucielleCardView(ctx, assets, this)
        v.collapsed = prefs.overlayCollapsed; v.sceneId = prefs.overlayScene; v.alpha = prefs.overlayOpacity / 100f
        v.track = NowPlayingHub.current
        val m = svc.resources.displayMetrics
        val p = WindowManager.LayoutParams(
            widthPx(), WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = if (prefs.overlayX >= 0) prefs.overlayX else m.widthPixels - widthPx() - (16 * dp).toInt()
            y = if (prefs.overlayY >= 0) prefs.overlayY else (m.heightPixels * 0.18f).toInt()
            title = "Lucielle"
        }
        try { wm.addView(v, p); view = v; lp = p; NowPlayingHub.useBeats("overlay", true) } catch (e: Throwable) { android.util.Log.w("Luciel", "overlay", e) }
    }

    fun hide() {
        val v = view ?: return
        try { wm.removeView(v) } catch (_: Throwable) {}
        view = null; lp = null
        NowPlayingHub.useBeats("overlay", false)
    }

    val isShowing get() = view != null

    private fun applySize() { val v = view ?: return; val p = lp ?: return; p.width = widthPx(); try { wm.updateViewLayout(v, p) } catch (_: Throwable) {} }

    private fun clampToScreen() {
        val p = lp ?: return; val v = view ?: return; val m = svc.resources.displayMetrics
        p.x = p.x.coerceIn(0, (m.widthPixels - p.width).coerceAtLeast(0))
        p.y = p.y.coerceIn(0, (m.heightPixels - v.height).coerceAtLeast(0))
    }

    // ---- LucielleCardView.Host
    override fun onDrag(dx: Int, dy: Int) { val p = lp ?: return; p.x += dx; p.y += dy; clampToScreen(); try { wm.updateViewLayout(view, p) } catch (_: Throwable) {} }
    override fun onDragEnd() {
        val p = lp ?: return
        // collapsed bubble snaps to the nearest screen edge
        if (view?.collapsed == true) { val m = svc.resources.displayMetrics; p.x = if (p.x + p.width / 2 < m.widthPixels / 2) 0 else m.widthPixels - p.width; try { wm.updateViewLayout(view, p) } catch (_: Throwable) {} }
        prefs.overlayX = p.x; prefs.overlayY = p.y
    }
    override fun onResize(dw: Int) { val p = lp ?: return; val nw = (p.width + dw).coerceIn((140 * dp).toInt(), (380 * dp).toInt()); p.width = nw; try { wm.updateViewLayout(view, p) } catch (_: Throwable) {} }
    override fun onResizeEnd() { val p = lp ?: return; prefs.overlaySizeDp = (p.width / dp).toInt(); clampToScreen() }
    override fun onOpenApp() {
        svc.startActivity(Intent(svc, MainActivity::class.java).setAction(MainActivity.ACTION_EXT_MODE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }
    override fun onSettings() { svc.startActivity(Intent(svc, OverlaySettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    override fun onCollapse(collapsed: Boolean) { prefs.overlayCollapsed = collapsed; view?.collapsed = collapsed; applySize(); clampToScreen(); onDragEnd() }
    override fun onClose() { dismissedKey = NowPlayingHub.current?.trackKey; hide() }

    companion object {
        @Volatile var instance: OverlayController? = null
        /** Luciel's own window is in front → hide the overlay (the full scene view is right there) */
        @Volatile var appInFront = false
            set(v) { field = v; instance?.refresh() }
    }
}
