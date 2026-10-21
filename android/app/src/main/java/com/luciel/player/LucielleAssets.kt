package com.luciel.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import org.json.JSONObject

/** Lucielle's dance sheets + scene art, read straight from the bundled web app (assets/www) so both sides match. */
class LucielleAssets(private val ctx: Context) {
    data class Dance(val tier: String, val sheet: Bitmap, val frames: Int, val cols: Int, val cell: Int, val loopBeats: Float, val loopBpm: Float = 120f) {
        val asSheet get() = CharSheet("", frames, cols, loopBeats, loopBpm)
    }
    data class Scene(val id: String, val name: String, val kind: String, val image: String, val thumb: String)

    private var dance: Dance? = null
    private val sceneCache = LinkedHashMap<String, Bitmap>(4, 0.75f, true)
    private var idle: Bitmap? = null
    private var icon: Bitmap? = null
    /** every bundled scene (pixel ones too: the floater follows the page, which uses them in Classic) */
    val allScenes: List<Scene> by lazy { loadScenes() }
    /** scenes offered by the outside-player card's picker */
    val scenes: List<Scene> by lazy { allScenes.filter { it.kind != "pixel" } }
    private val danceMeta: JSONObject? by lazy { try { JSONObject(read("www/mascot/dance/dance.json")) } catch (e: Throwable) { null } }

    private fun read(path: String) = ctx.assets.open(path).bufferedReader().use { it.readText() }
    /** raw asset stream ("www/...") */
    fun open(path: String): java.io.InputStream? = try { ctx.assets.open(path) } catch (_: Throwable) { null }

    private fun bmp(path: String, sample: Int = 1): Bitmap? = try {
        ctx.assets.open(path).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
    } catch (e: Throwable) { Log.w("Luciel", "asset $path: ${e.message}"); null }

    /** the sheet for this tempo tier (slow / mid / fast), decoded at half size (160 px frames) */
    fun dance(tier: String): Dance? {
        dance?.let { if (it.tier == tier) return it }
        val m = danceMeta?.optJSONObject(tier) ?: return dance
        val sheet = bmp("www/" + m.getString("sheet"), 2) ?: return dance
        val frames = m.getInt("frames"); val cols = m.getInt("cols")
        val loopBeats = (m.getDouble("duration") * m.getDouble("loopBpm") / 60.0).toFloat()
        dance?.sheet?.recycle()
        return Dance(tier, sheet, frames, cols, sheet.width / cols, loopBeats, m.getDouble("loopBpm").toFloat()).also { dance = it }
    }

    fun idle(): Bitmap? = idle ?: bmp("www/mascot/poses/idle.webp").also { idle = it }
    private val poses = HashMap<String, Bitmap?>()
    /** a built-in pose / emote picture (www/mascot/poses/<name>.webp); unknown names fall back to idle */
    fun pose(name: String): Bitmap? {
        if (name == "idle") return idle()
        if (!poses.containsKey(name)) poses[name] = bmp("www/mascot/poses/${name.replace(Regex("[^a-z-]"), "")}.webp")
        return poses[name] ?: idle()
    }
    fun icon(): Bitmap? = icon ?: bmp("www/icons/icon-192.png").also { icon = it }

    /** scene backgrounds; scenes whose art already contains Lucielle get swapped for a background-only one */
    fun sceneArt(id: String, large: Boolean): Bitmap? {
        val sc = allScenes.firstOrNull { it.id == id } ?: allScenes.firstOrNull { it.id == "pop" } ?: return null
        val use = if (sc.kind == "full") allScenes.firstOrNull { it.id == FULL_SWAP[sc.id] } ?: sc else sc
        val path = if (large) use.image else use.thumb
        sceneCache[path]?.let { return it }
        val b = bmp("www/$path") ?: return null
        sceneCache[path] = b
        while (sceneCache.size > 3) { val k = sceneCache.keys.first(); sceneCache.remove(k) }
        return b
    }

    private fun loadScenes(): List<Scene> = try {
        val arr = JSONObject(read("www/art/scenes.json")).getJSONArray("scenes")
        (0 until arr.length()).map { i -> arr.getJSONObject(i).let { Scene(it.getString("id"), it.optString("name"), it.optString("kind"), it.optString("image"), it.optString("thumb")) } }
    } catch (e: Throwable) { emptyList() }

    companion object {
        val FULL_SWAP = mapOf("aero-ambient" to "mood-sleepy", "blue-lofi" to "jazz", "red-rock" to "mood-hype", "slime-rave" to "synthwave")
    }
}
