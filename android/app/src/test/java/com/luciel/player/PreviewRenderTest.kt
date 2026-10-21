package com.luciel.player

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.os.SystemClock
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.zip.ZipInputStream

/**
 * 1.1.3 preview harness: draws the REAL Spotify card (LucielleCardView) and Luciel floater (FloaterView) in compact,
 * large and bubble with a published VisualState (City Punk pack scene from the bundled Styles pack, and the built-in
 * Graffiti Street with the red palette) using Robolectric's native Canvas, saves PNGs to app/build/previews and checks
 * the pictures really mirror the scene (not blank, scene colours present, the two scenes differ).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp-xxhdpi")
class PreviewRenderTest {
    private val ctx: Application = ApplicationProvider.getApplicationContext()
    private val out = File(System.getProperty("user.dir"), "build/previews").apply { mkdirs() }
    private val red = listOf("#ff2d48", "#ff8c5e", "#1a0408", "#060102", "#ffe7e9", "#120103", "#ff4a5b", "#8a2a33", "#561019", "#320810", "#0d0103")

    private fun theme(o: JSONObject, pal: List<String>, skin: String, palette: String) = o.apply {
        listOf("accent", "accent2", "bg2", "bg3", "text", "lcdBg", "lcdFg", "frame1", "frame2", "frame3", "frameDark").forEachIndexed { i, k -> put(k, pal[i]) }
        put("skin", skin); put("palette", palette)
    }

    /** the bundled pack's City Punk files, extracted like android.js would (files dir + paths) */
    private fun cityPunk(): JSONObject {
        val dir = File(ctx.filesDir, "visual").apply { mkdirs() }
        val want = mapOf("bg/city-punk.jpg" to "bg", "bg/city-punk-glow.jpg" to "glow", "char/city-punk-slow.webp" to "slow", "char/city-punk-mid.webp" to "mid",
            "char/city-punk-fast.webp" to "fast", "char/city-punk-idle.webp" to "idle", "char/city-punk-happy.webp" to "happy", "char/city-punk-headbang.webp" to "headbang")
        ZipInputStream(ctx.assets.open("www/android/packs/lucielle-styles-pack.zip")).use { z ->
            while (true) { val e = z.nextEntry ?: break; want[e.name]?.let { k -> File(dir, "cp-$k").writeBytes(z.readBytes()) } }
        }
        fun f(k: String) = File(dir, "cp-$k").absolutePath
        fun sh(k: String, frames: Int, beats: Int, bpm: Int) = JSONObject().put("file", f(k)).put("frames", frames).put("cols", 8).put("beats", beats).put("loopBpm", bpm)
        val ch = JSONObject().put("use", "custom").put("name", "Lucielle · City Punk")
            .put("dance", JSONObject().put("slow", sh("slow", 48, 8, 80)).put("mid", sh("mid", 48, 8, 112)).put("fast", sh("fast", 48, 8, 150)))
            .put("idle", f("idle")).put("emotes", JSONObject().put("happy", sh("happy", 24, 4, 120)).put("headbang", sh("headbang", 24, 4, 120)))
            .put("events", JSONObject().put("start", "happy").put("drop", "headbang"))
        return theme(JSONObject().put("scene", "lucielle-styles/city-punk").put("sceneName", "City Punk").put("kind", "video").put("bg", f("bg")).put("glow", f("glow"))
            .put("char", ch).put("vizMode", "spectrum").put("mascotSize", "m").put("glowColor", "#ff2a3d"), red, "aero", "red")
    }
    private fun graffiti(): JSONObject = theme(JSONObject().put("scene", "hiphop").put("sceneName", "Graffiti Street").put("kind", "layered")
        .put("bg", "asset:www/art/hiphop.webp").put("char", JSONObject().put("use", "lucielle")).put("vizMode", "both").put("mascotSize", "m"), red, "aero", "red")
    private fun classic(): JSONObject {
        val p = listOf("#1e94ee", "#74ccff", "#b4d3ec", "#6f9cc6", "#12253a", "#07162a", "#94dcff", "#e6ecf2", "#b9c6d3", "#8797a9", "#46556a")
        return theme(JSONObject().put("scene", "hiphop").put("sceneName", "Graffiti Street").put("kind", "layered").put("bg", "asset:www/art/px/hiphop.png").put("pixel", true)
            .put("char", JSONObject().put("use", "lucielle")).put("vizMode", "spectrum"), p, "classic", "classic")
    }

    private fun idle() { repeat(8) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(120) } }

    private fun render(tag: String, v: VisualState): Map<String, Bitmap> {
        val assets = LucielleAssets(ctx)
        val dp = ctx.resources.displayMetrics.density
        val now = SystemClock.elapsedRealtime()
        val ext = ExtTrack("com.spotify.music", "Spotify", "Nights Like This", "Drake", "Scorpion", 200_000, true, 61_000, now, 1f, 0, null, "hip hop", "k1", now)
        val web = WebState(id = "w1", title = "Nights Like This", artist = "Drake", album = "Scorpion", durationMs = 200_000, positionMs = 61_000, playing = true, hasTrack = true,
            bpm = 121f, beatPos = 130.0, theme = v.theme, sceneId = v.sceneId)
        val ch = object : LucielleCardView.Host {
            override fun onDrag(dx: Int, dy: Int) {}; override fun onDragEnd() {}; override fun onResize(dw: Int) {}; override fun onResizeEnd() {}
            override fun onOpenApp() {}; override fun onSettings() {}; override fun onCollapse(collapsed: Boolean) {}; override fun onClose() {}
            override fun onToggleSize() {}; override fun onOpenPlayer() {}; override fun onLongPressBubble() {}
        }
        val fh = object : FloaterView.Host {
            override fun onDrag(dx: Int, dy: Int) {}; override fun onDragEnd() {}; override fun onResize(dw: Int) {}; override fun onResizeEnd() {}
            override fun onCommand(cmd: String, arg: Long) {}; override fun onOpenApp() {}; override fun onMode(mode: String) {}; override fun onClose() {}; override fun onLongPressBubble() {}
        }
        val tctx = android.view.ContextThemeWrapper(ctx, R.style.Theme_Luciel)
        val views = linkedMapOf<String, Pair<View, Int>>(
            "card-compact" to (LucielleCardView(tctx, assets, ch).apply { track = ext; visual = v } to (200 * dp).toInt()),
            "card-large" to (LucielleCardView(tctx, assets, ch).apply { track = ext; visual = v; large = true } to (290 * dp).toInt()),
            "card-bubble" to (LucielleCardView(tctx, assets, ch).apply { track = ext; visual = v; collapsed = true } to (64 * dp).toInt()),
            "floater-compact" to (FloaterView(tctx, assets, fh).apply { state = web; visual = v; mode = FloaterGeometry.COMPACT } to (316 * dp).toInt()),
            "floater-large" to (FloaterView(tctx, assets, fh).apply { state = web; visual = v; mode = FloaterGeometry.LARGE } to (252 * dp).toInt()),
            "floater-bubble" to (FloaterView(tctx, assets, fh).apply { state = web; visual = v; mode = FloaterGeometry.BUBBLE } to (FloaterGeometry.BUBBLE_DP * dp).toInt()),
        )
        val res = LinkedHashMap<String, Bitmap>()
        for (pass in 0..2) for ((name, p) in views) {
            val (view, w) = p
            view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)
            val b = Bitmap.createBitmap(view.measuredWidth, view.measuredHeight, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF2B2B30.toInt()) }
            view.draw(Canvas(b))
            if (pass == 2) { res[name] = b; File(out, "1.1.3-$tag-$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            idle()                                  // let the async picture decodes land
        }
        return res
    }

    /** share of pixels that are clearly reddish (City Punk / red palette) */
    private fun redShare(b: Bitmap): Float { var n = 0; var t = 0
        for (y in 0 until b.height step 3) for (x in 0 until b.width step 3) { val c = b.getPixel(x, y); val r = (c shr 16) and 255; val g = (c shr 8) and 255; val bl = c and 255; t++; if (r > 120 && r > g * 1.6 && r > bl * 1.4) n++ }
        return n.toFloat() / t }
    private fun distinct(b: Bitmap): Int { val s = HashSet<Int>(); for (y in 0 until b.height step 4) for (x in 0 until b.width step 4) s.add(b.getPixel(x, y) and 0xF0F0F0); return s.size }

    @Test fun cardAndFloaterMirrorTheScene() {
        val punk = render("citypunk", VisualState.from(cityPunk()))
        val graf = render("graffiti-red", VisualState.from(graffiti()))
        val cls = render("graffiti-classic", VisualState.from(classic()))
        for ((k, b) in punk) assertTrue("$k has a picture (${distinct(b)} colours)", distinct(b) > 60)
        for ((k, b) in graf) assertTrue("$k has a picture", distinct(b) > 60)
        for ((k, b) in cls) assertTrue("$k has a picture", distinct(b) > 20)
        // the red palette shows in the card (accent buttons, glow) for both red looks
        assertTrue("City Punk card is red-themed (${redShare(punk.getValue("card-large"))})", redShare(punk.getValue("card-large")) > 0.01f)
        // the two scenes are really different pictures in every mode
        for (k in punk.keys) {
            val a = punk.getValue(k); val b = graf.getValue(k)
            var diff = 0; var t = 0
            for (y in 0 until a.height step 4) for (x in 0 until a.width step 4) { t++; if (Math.abs(((a.getPixel(x, y) shr 8) and 255) - ((b.getPixel(x, y) shr 8) and 255)) > 30) diff++ }
            assertTrue("$k: City Punk vs Graffiti Street differ (${diff * 100 / t} %)", diff * 100 / t > 8)
        }
    }
}
