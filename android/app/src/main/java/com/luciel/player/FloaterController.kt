package com.luciel.player

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.WindowInsets
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import java.util.concurrent.Executors

/**
 * Luciel's own floating mini player over other apps (needs "Display over other apps"). App-scoped, so it works without
 * notification access. Shares the screen with the outside-player card through [OverlayPolicy]: one floating window at a
 * time, Luciel's own playback first.
 */
object FloaterController : FloaterView.Host {
    private const val TAG = "LucielFloater"
    private lateinit var app: Context
    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val assets by lazy { LucielleAssets(app) }
    private var view: FloaterView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var inited = false

    @Volatile var state: WebState? = null; private set
    private var cs = CloseRules.Floater()
    /** the user pressed Pop out (one-shot: ends when Luciel comes back to the front, or on ×) */
    val poppedOut get() = cs.poppedOut
    /** closed (×, long-press on the bubble, dismiss target, notification) or auto-hidden after a long pause */
    val dismissed get() = cs.dismissed
    /** Luciel's own window is on screen */
    var appInFront = false
        set(v) { if (field != v) { field = v; if (v) cs = CloseRules.appFront(cs); update() } }
    private val target by lazy { DismissTarget(app) }

    private var coverKey: String? = null
    private var sceneKey: String? = null
    private val autoHide = Runnable { if (state?.playing != true) { cs = CloseRules.pausedLong(cs); update() } }

    fun init(ctx: Context) {
        if (inited) return
        inited = true
        app = ctx.applicationContext; prefs = Prefs.get(app)
        cs = cs.copy(closed = prefs.floaterClosed)
        NowPlayingHub.listeners.add { main.post { update() } }
    }

    val isShowing get() = view != null
    private fun canDraw() = inited && Settings.canDrawOverlays(app)

    fun input(): OverlayPolicy.Input {
        val s = state; val ext = NowPlayingHub.current
        return OverlayPolicy.Input(
            canDraw = canDraw(), appInFront = appInFront, ownHasTrack = s?.hasTrack == true, ownPlaying = s?.playing == true,
            poppedOut = poppedOut, autoFloater = inited && prefs.autoFloater, ownShowing = view != null, ownDismissed = dismissed,
            extWanted = OverlayController.instance?.wantsCard() == true, extPlaying = ext?.playing == true,
        )
    }
    fun decision(): OverlayPolicy.Show = if (!inited) OverlayPolicy.Show.NONE else OverlayPolicy.decide(input())
    /** may the outside-player card show? (false while our floater owns the screen) */
    fun allowsExt(): Boolean = !inited || (view == null && decision() != OverlayPolicy.Show.OWN)

    // ------------------------------------------------------------------ inputs
    fun onWebState(s: WebState) {
        if (!inited) return
        val was = state
        if (s.playing && was?.playing != true) { cs = CloseRules.playStarted(cs); main.removeCallbacks(autoHide) }
        if (!s.playing && was?.playing == true && view != null && !poppedOut && prefs.autoHideSec > 0) { main.removeCallbacks(autoHide); main.postDelayed(autoHide, prefs.autoHideSec * 1000L) }
        if (!s.hasTrack) cs = CloseRules.trackGone(cs)
        state = s
        loadArt(s)
        view?.state = s
        update()
    }

    /** "Pop out" on the phone player: false when the permission is missing */
    fun popOut(): Boolean {
        if (!canDraw()) return false
        cs = CloseRules.popOut(cs); prefs.floaterClosed = false; main.removeCallbacks(autoHide)
        DebugLog.add("overlay", "floater: Pop out")
        update(); return true
    }
    /** closes the floater for good (until Pop out). Never sends a playback command. */
    fun close(why: String = "✕") {
        if (!inited) return
        cs = CloseRules.close(cs); prefs.floaterClosed = true
        DebugLog.add("overlay", "floater closed ($why) – music keeps playing")
        target.finish(); update()
    }
    /** auto pop-out switched on in Settings: allow it again */
    fun autoSettingChanged(on: Boolean) { if (on) { cs = CloseRules.autoSettingOn(cs); prefs.floaterClosed = false }; update() }

    fun update() {
        if (!inited) return
        main.removeCallbacks(updateRunnable); main.post(updateRunnable)
    }
    private val updateRunnable = Runnable {
        val d = decision()
        if (d == OverlayPolicy.Show.OWN) show() else hide()
        OverlayController.instance?.refresh()
    }

    // ------------------------------------------------------------------ art (decoded off the main thread)
    private fun loadArt(s: WebState) {
        val ck = s.id + "|" + (s.artData?.size ?: 0) + "|" + (s.artUri ?: "")
        if (ck != coverKey) {
            coverKey = ck
            val data = s.artData; val uri = s.artUri
            io.execute {
                val b: Bitmap? = try {
                    when {
                        data != null -> decode(data)
                        uri != null -> app.contentResolver.openInputStream(uri)?.use { decode(it.readBytes()) }
                        else -> null
                    }
                } catch (e: Throwable) { null }
                main.post { if (coverKey == ck) view?.cover = b; lastCover = if (coverKey == ck) b else lastCover }
            }
        }
        val sk = s.sceneId + "|" + (s.sceneArt?.size ?: 0)
        if (sk != sceneKey) {
            sceneKey = sk
            val data = s.sceneArt
            if (data == null) { lastScene = null; view?.sceneBitmap = null }
            else io.execute { val b = try { decode(data, 720) } catch (_: Throwable) { null }; main.post { if (sceneKey == sk) { lastScene = b; view?.sceneBitmap = b } } }
        }
    }
    private var lastCover: Bitmap? = null
    private var lastScene: Bitmap? = null
    private fun decode(bytes: ByteArray, max: Int = 360): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var sample = 1; while (maxOf(o.outWidth, o.outHeight) / (sample * 2) >= max) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    // ------------------------------------------------------------------ window
    private val dp get() = app.resources.displayMetrics.density
    private val wm get() = app.getSystemService(WindowManager::class.java)
    private val mode get() = FloaterGeometry.normMode(prefs.floaterMode)
    private fun widthPx(m: String = mode) = (when (m) {
        FloaterGeometry.BUBBLE -> FloaterGeometry.BUBBLE_DP
        FloaterGeometry.LARGE -> prefs.floaterLargeDp
        else -> prefs.floaterCompactDp
    } * dp).toInt()
    private fun heightPx(m: String = mode) = (FloaterGeometry.heightDp(m, widthPx(m) / dp, state?.theme?.classic == true) * dp).toInt()

    /** screen area without the status bar, gesture/nav bar and cutouts */
    fun safeBounds(): FloaterGeometry.Bounds {
        val m = app.resources.displayMetrics
        if (Build.VERSION.SDK_INT >= 30) {
            val wmx = wm.currentWindowMetrics
            val r = wmx.bounds
            val ins = wmx.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val pad = (4 * dp).toInt()
            return FloaterGeometry.Bounds(ins.left + pad, ins.top + pad, r.width() - ins.right - pad, r.height() - ins.bottom - pad)
        }
        return FloaterGeometry.Bounds(0, (24 * dp).toInt(), m.widthPixels, m.heightPixels - (48 * dp).toInt())
    }

    private fun show() {
        if (view != null) { view?.state = state; return }
        if (!canDraw()) return
        val v = FloaterView(ContextThemeWrapper(app, R.style.Theme_Luciel), assets, this)
        v.mode = mode; v.state = state; v.cover = lastCover; v.sceneBitmap = lastScene
        val b = safeBounds()
        val w = widthPx(); val h = heightPx()
        val p = WindowManager.LayoutParams(
            w, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val (x0, y0) = FloaterGeometry.clamp(if (prefs.floaterX >= 0) prefs.floaterX else b.right - w, if (prefs.floaterY >= 0) prefs.floaterY else b.top + ((b.bottom - b.top) * 0.12f).toInt(), w, h, b)
            x = x0; y = y0
            title = "Luciel mini player"
        }
        try { wm.addView(v, p); view = v; lp = p; Log.i(TAG, "floater shown ($mode)") } catch (e: Throwable) { Log.w(TAG, "floater", e) }
    }

    fun hide() {
        val v = view ?: return
        try { wm.removeView(v) } catch (_: Throwable) {}
        view = null; lp = null
        Log.i(TAG, "floater hidden")
    }

    private fun relayout() { val v = view ?: return; val p = lp ?: return; try { wm.updateViewLayout(v, p) } catch (_: Throwable) {} }
    private fun snapAndSave(bubble: Boolean) {
        val p = lp ?: return
        val (x, y) = FloaterGeometry.snap(p.x, p.y, p.width, heightPx(), safeBounds(), (FloaterGeometry.SNAP_DP * dp).toInt(), bubble)
        p.x = x; p.y = y; relayout()
        prefs.floaterX = x; prefs.floaterY = y
    }

    // ------------------------------------------------------------------ FloaterView.Host
    override fun onDrag(dx: Int, dy: Int) {
        val p = lp ?: return
        val (x, y) = FloaterGeometry.clamp(p.x + dx, p.y + dy, p.width, heightPx(), safeBounds()); p.x = x; p.y = y; relayout()
        target.show(); target.track(p.x + p.width / 2, p.y + (view?.height ?: 0) / 2)
    }
    override fun onDragEnd() { if (target.finish()) close("dropped on the close target") else snapAndSave(mode == FloaterGeometry.BUBBLE) }
    override fun onLongPressBubble() = close("long-press on the bubble")
    override fun onResize(dw: Int) {
        val p = lp ?: return
        val (lo, hi) = if (mode == FloaterGeometry.LARGE) Prefs.FLOATER_LARGE_MIN to Prefs.FLOATER_LARGE_MAX else Prefs.FLOATER_COMPACT_MIN to Prefs.FLOATER_COMPACT_MAX
        val b = safeBounds()
        p.width = (p.width + dw).coerceIn((lo * dp).toInt(), minOf((hi * dp).toInt(), b.right - b.left)); relayout()
    }
    override fun onResizeEnd() {
        val p = lp ?: return
        val wdp = (p.width / dp).toInt()
        if (mode == FloaterGeometry.LARGE) prefs.floaterLargeDp = wdp else prefs.floaterCompactDp = wdp
        snapAndSave(false)
    }
    @OptIn(UnstableApi::class)
    override fun onCommand(cmd: String, arg: Long) {
        Log.i(TAG, "command $cmd $arg")
        if (BuildConfig.DEBUG && DebugFloaterHook.command(cmd, arg)) return
        val svc = PlaybackService.instance
        if (svc != null) svc.control(cmd, arg) else WebBridge.sendCommand(cmd, arg)
    }
    override fun onOpenApp() {
        app.startActivity(Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }
    override fun onMode(mode: String) {
        val cur = this.mode
        val next = if (mode == "expand") FloaterGeometry.normMode(prefs.floaterLastMode).let { if (it == FloaterGeometry.BUBBLE) FloaterGeometry.COMPACT else it } else FloaterGeometry.normMode(mode)
        if (next == cur) return
        if (cur != FloaterGeometry.BUBBLE) prefs.floaterLastMode = cur
        val p = lp; val v = view
        // keep the window anchored on the side it sits on
        val rightAnchored = p != null && p.x + p.width / 2 > (safeBounds().let { (it.left + it.right) / 2 })
        val oldRight = p?.let { it.x + it.width } ?: 0
        prefs.floaterMode = next
        if (p != null && v != null) {
            p.width = widthPx(next); if (rightAnchored) p.x = oldRight - p.width
            v.mode = next; relayout(); main.post { snapAndSave(next == FloaterGeometry.BUBBLE) }
        }
    }
    override fun onClose() = close("✕")

    /** for tests / debugging: current window rectangle */
    fun windowRect(): IntArray? { val p = lp ?: return null; val v = view ?: return null; return intArrayOf(p.x, p.y, p.width, v.height) }
}
