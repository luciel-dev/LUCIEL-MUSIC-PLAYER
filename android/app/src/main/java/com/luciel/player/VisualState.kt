package com.luciel.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

/** One tempo-synced sprite-sheet loop (dance or animated emote) of a pack character. `file` is an absolute path or "asset:www/..." */
data class CharSheet(val file: String, val frames: Int, val cols: Int, val beats: Float, val loopBpm: Float)

/**
 * What Luciel's own stage shows right now – published by the page (android.js → WebBridge.visualState) every time the
 * scene, theme, character or visualizer changes, and persisted so the floater and the Spotify card look the same after a
 * process restart. Pack pictures arrive as files extracted into filesDir/visual (paths), built-in art as "asset:www/…".
 */
data class VisualState(
    val sceneId: String = "", val sceneName: String = "", val kind: String = "layered",
    /** stage background: absolute file path or "asset:www/…" */
    val bg: String = "", val glow: String = "",
    /** Classic skin: chunky pixel stage */
    val pixel: Boolean = false,
    /** the illustration already contains Lucielle (page soft-focuses it and draws the live cut-out on top) */
    val fullArt: Boolean = false,
    /** "lucielle" (built-in) | "custom" (pack outfit) | "none" */
    val charUse: String = "lucielle", val charName: String = "", val charScale: Float = 1f,
    val dances: Map<String, CharSheet> = emptyMap(), val idle: String = "",
    /** emote name → animated sheet; still emotes are in [emoteStills] */
    val emotes: Map<String, CharSheet> = emptyMap(), val emoteStills: Map<String, String> = emptyMap(),
    /** music event → emote name (pack character.events) */
    val events: Map<String, String> = emptyMap(),
    val theme: FloaterTheme = FloaterTheme(),
    /** spectrum | scope | both | off (the page's visualizer mode) */
    val vizMode: String = "spectrum",
    val mascot: Boolean = true, val mascotSize: String = "m",
    val glowColor: Int = 0,
    val at: Long = 0L,
) {
    val hasState get() = sceneId.isNotEmpty()
    /** Lucielle's height as a fraction of the stage (same as the page: s / m / l) */
    val charHeight get() = when (mascotSize) { "s" -> 0.66f; "l" -> 0.98f; else -> 0.84f }

    companion object {
        fun parse(json: String): VisualState? = try { from(JSONObject(json)) } catch (_: Throwable) { null }

        fun from(o: JSONObject): VisualState {
            fun sheet(x: JSONObject?): CharSheet? {
                x ?: return null
                val f = x.optString("file"); if (f.isEmpty()) return null
                return CharSheet(f, x.optInt("frames", 1).coerceAtLeast(1), x.optInt("cols", 1).coerceAtLeast(1), x.optDouble("beats", 4.0).toFloat().takeIf { it > 0 } ?: 4f, x.optDouble("loopBpm", 120.0).toFloat().takeIf { it > 0 } ?: 120f)
            }
            fun sheets(x: JSONObject?): Map<String, CharSheet> { x ?: return emptyMap(); val m = LinkedHashMap<String, CharSheet>(); for (k in x.keys()) sheet(x.optJSONObject(k))?.let { m[k] = it }; return m }
            fun strings(x: JSONObject?): Map<String, String> { x ?: return emptyMap(); val m = LinkedHashMap<String, String>(); for (k in x.keys()) x.optString(k).takeIf { it.isNotEmpty() }?.let { m[k] = it }; return m }
            val ch = o.optJSONObject("char")
            return VisualState(
                sceneId = o.optString("scene"), sceneName = o.optString("sceneName"), kind = o.optString("kind", "layered").ifBlank { "layered" },
                // "bg" is the scene picture here; the panel colour comes as "bg2"
                bg = o.optString("bg"), glow = o.optString("glow"), pixel = o.optBoolean("pixel"), fullArt = o.optBoolean("fullArt"),
                charUse = ch?.optString("use", "lucielle")?.ifBlank { "lucielle" } ?: "lucielle", charName = ch?.optString("name") ?: "",
                charScale = (ch?.optDouble("scale", 1.0) ?: 1.0).toFloat().takeIf { it in 0.3f..2f } ?: 1f,
                dances = sheets(ch?.optJSONObject("dance")), idle = ch?.optString("idle") ?: "",
                emotes = sheets(ch?.optJSONObject("emotes")), emoteStills = strings(ch?.optJSONObject("stills")), events = strings(ch?.optJSONObject("events")),
                theme = Themes.of(JSONObject(o.toString()).put("bg", o.optString("bg2"))), vizMode = o.optString("vizMode", "spectrum").ifBlank { "spectrum" },
                mascot = o.optBoolean("mascot", true), mascotSize = o.optString("mascotSize", "m").ifBlank { "m" },
                glowColor = CssColor.parse(o.optString("glowColor", ""), 0), at = o.optLong("at", 0L),
            )
        }

        /** safe file name for a pack file key ("lucielle-styles/city-punk/dance-mid") */
        fun fileKey(key: String): String = key.replace(Regex("[^A-Za-z0-9._-]+"), "_").trim('_', '.').take(120).ifEmpty { "x" }
    }
}

/**
 * Holds the current [VisualState] for the native views (Luciel floater + Spotify card). The page sets it; it is
 * persisted in prefs ("visual") and read back at process start, so a restarted overlay service already shows the
 * user's scene and theme before the page has loaded.
 */
object VisualHub {
    private const val KEY = "visual"
    private val main = Handler(Looper.getMainLooper())
    @Volatile var current: VisualState = VisualState(); private set
    @Volatile private var raw: String = ""
    val listeners = CopyOnWriteArrayList<(VisualState) -> Unit>()
    private var prefs: Prefs? = null
    @Volatile var dir: File? = null; private set

    fun init(ctx: Context) {
        val p = Prefs.get(ctx); prefs = p
        dir = File(ctx.filesDir, "visual").apply { mkdirs() }
        p.sp.getString(KEY, null)?.let { s -> VisualState.parse(s)?.let { raw = s; current = it } }
    }

    /** from the page; returns true when something the native views draw actually changed */
    fun set(json: String): Boolean {
        if (json == raw) return false
        val v = VisualState.parse(json) ?: return false
        raw = json; current = v
        prefs?.sp?.edit()?.putString(KEY, json)?.apply()
        main.post { for (l in listeners) try { l(v) } catch (_: Throwable) {} }
        return true
    }

    /** an extracted pack file: path if it is already there with this size, else null */
    fun existing(key: String, size: Long): File? {
        val f = File(dir ?: return null, VisualState.fileKey(key))
        return if (f.isFile && f.length() > 0 && (size <= 0 || sizeTag(f) == size)) f else null
    }
    fun put(key: String, size: Long, bytes: ByteArray): File? {
        val d = dir ?: return null
        val f = File(d, VisualState.fileKey(key))
        val tmp = File(d, f.name + ".tmp")
        tmp.writeBytes(bytes); if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        File(d, f.name + ".src").writeText(size.toString())
        return f
    }
    /** size of the page's original file (the page may send a downscaled copy) */
    private fun sizeTag(f: File): Long = try { File(f.parentFile, f.name + ".src").readText().trim().toLong() } catch (_: Throwable) { -1 }
}

/** page palette / skin colours (CSS strings) → ARGB ints for the native views */
object Themes {
    fun of(o: JSONObject): FloaterTheme {
        val d = FloaterTheme()
        fun c(k: String, fb: Int) = CssColor.parse(o.optString(k, ""), fb)
        return FloaterTheme(skin = o.optString("skin", "aero").ifBlank { "aero" }, palette = o.optString("palette", "aero").ifBlank { "aero" },
            accent = c("accent", d.accent), accent2 = c("accent2", d.accent2), bg = c("bg", d.bg), bg3 = c("bg3", d.bg3), text = c("text", d.text),
            lcdBg = c("lcdBg", d.lcdBg), lcdFg = c("lcdFg", d.lcdFg), frame1 = c("frame1", d.frame1), frame2 = c("frame2", d.frame2), frame3 = c("frame3", d.frame3), frameDark = c("frameDark", d.frameDark))
    }
}

/** Pure rules shared by the floater and the Spotify card so they move like the page's stage (js/luciel.js). */
object VisualRules {
    /** dance tier, same thresholds as the page: <96 slow, ≤126 mid, else fast (no tempo yet: mid) */
    fun tier(bpm: Float): String = when { bpm <= 0f -> "mid"; bpm < 96f -> "slow"; bpm <= 126f -> "mid"; else -> "fast" }

    /** loop speed multiplier so the loop plays at 0.7–1.45× its own tempo (page: danceLoop) */
    fun mult(bpm: Float, loopBpm: Float): Double {
        if (bpm <= 0f || loopBpm <= 0f) return 1.0
        var m = 1.0
        while (bpm * m / loopBpm < 0.7) m *= 2
        while (bpm * m / loopBpm > 1.45) m /= 2
        return m
    }

    /** frame of a beat-synced sprite loop at this beat position */
    fun frameIndex(beat: Double, bpm: Float, sheet: CharSheet): Int {
        val lb = beat * mult(bpm, sheet.loopBpm)
        val pos = ((lb / sheet.beats) % 1.0 + 1.0) % 1.0
        return (Math.floor(pos * sheet.frames).toInt()) % sheet.frames
    }

    /** source rect of frame [i] in a sheet of [w]×[h] px: left, top, right, bottom */
    fun cell(i: Int, sheet: CharSheet, w: Int, h: Int): IntArray {
        val rows = (sheet.frames + sheet.cols - 1) / sheet.cols
        val fw = w / sheet.cols; val fh = h / rows.coerceAtLeast(1)
        val c = i % sheet.cols; val r = i / sheet.cols
        return intArrayOf(c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)
    }

    sealed class Pick {
        data class Loop(val sheet: CharSheet) : Pick()
        data class Still(val file: String) : Pick()
        /** built-in Lucielle: dance sheet for a tier / a pose image name */
        data class BuiltinDance(val tier: String) : Pick()
        data class BuiltinPose(val name: String) : Pick()
        object None : Pick()
    }

    /**
     * What Lucielle shows: an emote while one runs, else dancing while playing, else the idle picture (page: choose()).
     * [emote] is a page emote name (happy, surprised, headbang …).
     */
    fun pick(v: VisualState, playing: Boolean, bpm: Float, emote: String?): Pick {
        if (!v.mascot || v.charUse == "none") return Pick.None
        // pack emotes / dance loops apply to Lucielle in a pack outfit too (page: choose())
        if (emote != null) { v.emotes[emote]?.let { return Pick.Loop(it) }; v.emoteStills[emote]?.let { return Pick.Still(it) } }
        if (playing) { (v.dances[tier(bpm)] ?: (if (v.charUse == "custom") v.dances["mid"] ?: v.dances.values.firstOrNull() else null))?.let { return Pick.Loop(it) } }
        if (v.charUse == "custom") {
            if (v.idle.isNotEmpty()) return Pick.Still(v.idle)
            v.dances["slow"]?.let { return Pick.Loop(it) }
        }
        if (emote != null) return Pick.BuiltinPose(emote)
        return if (playing) Pick.BuiltinDance(tier(bpm)) else Pick.BuiltinPose("idle")
    }

    /** emote for a music event: the pack's own mapping, else the page's built-in reaction */
    fun emoteFor(v: VisualState, event: String): String? {
        v.events[event]?.let { return it }
        return when (event) { "start" -> "surprised"; "drop" -> "happy"; else -> null }
    }

    /** bubble: a square crop of the stage around Lucielle's head (fractions of the stage box: left, top, size) */
    fun headCrop(charHeight: Float): FloatArray {
        val size = (charHeight * 0.55f).coerceIn(0.35f, 0.6f)
        val headY = 1f - 0.04f - charHeight * 0.97f            // top of her head (page: box.y = H - charH - 4 %)
        return floatArrayOf(0.5f - size / 2, (headY - size * 0.08f).coerceIn(0f, 1f - size), size)
    }
}

/** the tempo chip text: "♩ 121 BPM · live" (live beat from the phone's audio), "· tapped", "· steady" (fallback) */
object TempoLabel {
    fun of(bpm: Float, source: String?): String {
        val b = Math.round(if (bpm > 0f) bpm else 120f)
        return when (source) { "live" -> "♩ $b BPM · live"; "tap" -> "♩ $b BPM · tapped"; else -> "♩ $b BPM · steady · tap" }
    }
}
