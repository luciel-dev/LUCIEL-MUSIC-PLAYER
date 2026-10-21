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
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.zip.ZipFile

/**
 * 1.2.0: the REAL floater (FloaterView) and Spotify card with a Lucielle Genres add-on scene. The add-on is NOT in the
 * APK, so this reads the released zip (GENRES_ZIP, default /workspace/luciel-dist/lucielle-genres-pack.zip) and skips
 * when it is not there. Files are extracted like android.js does for an imported pack; PNGs go to build/previews.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w411dp-h891dp-xxhdpi")
class GenresPreviewTest {
    private val ctx: Application = ApplicationProvider.getApplicationContext()
    private val out = File(System.getProperty("user.dir"), "build/previews").apply { mkdirs() }
    private val zip = File(System.getenv("GENRES_ZIP") ?: "/workspace/luciel-dist/lucielle-genres-pack.zip")
    private val pal = listOf("#b06bff", "#ffb347", "#140a2c", "#060312", "#f3e9ff", "#0d0620", "#d7b4ff", "#3a2a5e", "#2a1d48", "#1c1233", "#0a0614")

    private fun state(sceneId: String, part: String, outfitScene: String = sceneId): JSONObject {
        val dir = File(ctx.filesDir, "visual").apply { mkdirs() }
        ZipFile(zip).use { z ->
            val m = JSONObject(z.getInputStream(z.getEntry("pack.json")).bufferedReader().readText())
            val scenes = m.getJSONArray("scenes")
            fun scene(id: String): JSONObject { for (i in 0 until scenes.length()) if (scenes.getJSONObject(i).getString("id") == id) return scenes.getJSONObject(i); error(id) }
            val s = scene(sceneId); val c = scene(outfitScene).getJSONObject("character")
            fun file(p: String): String { val f = File(dir, "g-" + p.replace('/', '_')); if (!f.exists()) f.writeBytes(z.getInputStream(z.getEntry(p)).readBytes()); return f.absolutePath }
            fun sh(o: JSONObject) = JSONObject().put("file", file(o.getString("sheet"))).put("frames", o.getInt("frames")).put("cols", o.getInt("columns")).put("beats", o.getInt("beats")).put("loopBpm", o.getInt("loopBpm"))
            val v = s.getJSONObject("variants").getJSONObject(part)
            val dance = JSONObject(); c.getJSONObject("dance").let { d -> d.keys().forEach { k -> dance.put(k, sh(d.getJSONObject(k))) } }
            val emotes = JSONObject(); c.getJSONObject("emotes").let { d -> d.keys().forEach { k -> (d.opt(k) as? JSONObject)?.let { emotes.put(k, sh(it)) } } }
            val ch = JSONObject().put("use", "custom").put("name", c.getString("name")).put("dance", dance).put("idle", file(c.getString("idle"))).put("emotes", emotes).put("events", c.getJSONObject("events"))
            val o = JSONObject().put("scene", "lucielle-genres/$sceneId~$part").put("sceneName", s.getString("name")).put("kind", "video").put("bg", file(v.getString("image")))
                .put("glow", file(v.getString("glow"))).put("char", ch).put("vizMode", "spectrum").put("mascotSize", "m").put("glowColor", "#c77dff")
            listOf("accent", "accent2", "bg2", "bg3", "text", "lcdBg", "lcdFg", "frame1", "frame2", "frame3", "frameDark").forEachIndexed { i, k -> o.put(k, pal[i]) }
            return o.put("skin", "aero").put("palette", "blue")
        }
    }

    private fun idle() { repeat(8) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(120) } }

    private fun render(tag: String, v: VisualState): Map<String, Bitmap> {
        val assets = LucielleAssets(ctx)
        val dp = ctx.resources.displayMetrics.density
        val now = SystemClock.elapsedRealtime()
        val ext = ExtTrack("com.spotify.music", "Spotify", "Rooftop Nights", "Some Rapper", "Skyline", 200_000, true, 61_000, now, 1f, 0, null, "hip hop", "k1", now)
        val web = WebState(id = "w1", title = "Rooftop Nights", artist = "Some Rapper", album = "Skyline", durationMs = 200_000, positionMs = 61_000, playing = true, hasTrack = true,
            bpm = 96f, beatPos = 98.0, theme = v.theme, sceneId = v.sceneId)
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
            "floater-large" to (FloaterView(tctx, assets, fh).apply { state = web; visual = v; mode = FloaterGeometry.LARGE } to (252 * dp).toInt()),
            "floater-compact" to (FloaterView(tctx, assets, fh).apply { state = web; visual = v; mode = FloaterGeometry.COMPACT } to (316 * dp).toInt()),
            "card-large" to (LucielleCardView(tctx, assets, ch).apply { track = ext; visual = v; large = true } to (290 * dp).toInt()),
        )
        val res = LinkedHashMap<String, Bitmap>()
        for (pass in 0..2) for ((name, p) in views) {
            val (view, w) = p
            view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)
            val b = Bitmap.createBitmap(view.measuredWidth, view.measuredHeight, Bitmap.Config.ARGB_8888).apply { eraseColor(0xFF2B2B30.toInt()) }
            view.draw(Canvas(b))
            if (pass == 2) { res[name] = b; File(out, "1.2.0-$tag-$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            idle()
        }
        return res
    }
    private fun distinct(b: Bitmap): Int { val s = HashSet<Int>(); for (y in 0 until b.height step 4) for (x in 0 until b.width step 4) s.add(b.getPixel(x, y) and 0xF0F0F0); return s.size }
    private fun diff(a: Bitmap, b: Bitmap): Int { var d = 0; var t = 0
        for (y in 0 until minOf(a.height, b.height) step 4) for (x in 0 until minOf(a.width, b.width) step 4) { t++; if (Math.abs(((a.getPixel(x, y) shr 8) and 255) - ((b.getPixel(x, y) shr 8) and 255)) > 30) d++ }
        return d * 100 / maxOf(1, t) }

    @Test fun floaterShowsGenreScenes() {
        assumeTrue("Lucielle Genres zip not found at $zip (add-on, not bundled)", zip.exists())
        val night = render("genres-hiphop-night", VisualState.from(state("hip-hop", "night")))
        val day = render("genres-hiphop-day", VisualState.from(state("hip-hop", "day")))
        val mix = render("genres-altrock-velvet", VisualState.from(state("alt-rock", "night", "rnb")))
        for ((k, b) in night) assertTrue("$k has a picture (${distinct(b)} colours)", distinct(b) > 60)
        for (k in night.keys) assertTrue("$k: night vs day differ (${diff(night.getValue(k), day.getValue(k))} %)", diff(night.getValue(k), day.getValue(k)) > 5)
        for (k in night.keys) assertTrue("$k: hip-hop vs alt-rock mix differ", diff(night.getValue(k), mix.getValue(k)) > 5)
    }
}
