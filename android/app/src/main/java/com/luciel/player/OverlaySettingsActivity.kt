package com.luciel.player

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Long-press on the floating Lucielle opens this. */
class OverlaySettingsActivity : ComponentActivity() {
    private val prefs by lazy { Prefs.get(this) }
    private val dp by lazy { resources.displayMetrics.density }
    private lateinit var box: LinearLayout
    private val Int.px get() = (this * dp).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#141E2B")) }
        box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(box, MATCH_PARENT, WRAP_CONTENT)
        setContentView(scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, ins -> val b = ins.getInsets(WindowInsetsCompat.Type.systemBars()); v.setPadding(20.px + b.left, 16.px + b.top, 20.px + b.right, 16.px + b.bottom); ins }
    }

    override fun onResume() { super.onResume(); render() }

    private fun changed() { OverlayController.instance?.refresh() }

    private fun render() {
        box.removeAllViews()
        box.addView(label("Floating Lucielle", 24f, true))
        box.addView(label("Dances over Spotify and other players. Drag to move · corner handle to resize · – to shrink to a bubble · tap to open Luciel.", 14f, false, 0xAAFFFFFF.toInt()))
        section("Show")
        switch("Show the floating Lucielle", prefs.overlayEnabled) { prefs.overlayEnabled = it; changed() }
        switch("Spotify only (ignore other players)", prefs.spotifyOnly) { prefs.spotifyOnly = it; NowPlayingHub.refresh(); changed() }
        choice("Hide after the music pauses", listOf("Never" to 0, "10 s" to 10, "20 s" to 20, "1 min" to 60), prefs.autoHideSec) { prefs.autoHideSec = it; changed() }
        section("Size & look")
        choice("Size", listOf("Small" to 150, "Medium" to 200, "Large" to 270, "XL" to 340), listOf(150, 200, 270, 340).minBy { kotlin.math.abs(it - prefs.overlaySizeDp) }) { prefs.overlaySizeDp = it; prefs.overlayCollapsed = false; changed() }
        slider("Opacity", 30, 100, prefs.overlayOpacity) { prefs.overlayOpacity = it; changed() }
        val scenes = LucielleAssets(this).scenes.filter { it.kind != "full" }
        choice("Scene", listOf("Auto (cover colours, title words, tempo)" to "auto") + scenes.map { it.name to it.id }, prefs.overlayScene, vertical = true) { prefs.overlayScene = it; changed() }
        section("Beat")
        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        switch("Listen to the music's levels (system visualizer)", prefs.useVisualizer) { prefs.useVisualizer = it; NowPlayingHub.restartBeats() }
        box.addView(label(when {
            !mic -> "Beat detection permission is off – Lucielle uses the steady tempo below. Tap the ♪ chip on the card to tap the tempo."
            NowPlayingHub.beats.vizState == "silent" -> "This phone gives the visualizer silence (common with some players / phones) – using the steady tempo below."
            NowPlayingHub.beats.vizState == "unavailable" -> "This phone doesn't allow the system visualizer – using the steady tempo below."
            else -> "When the visualizer can't hear anything, Lucielle falls back to the steady tempo below."
        }, 13f, false, 0x99FFFFFF.toInt()))
        slider("Fallback tempo (BPM)", 60, 200, prefs.fallbackBpm.toInt()) { prefs.fallbackBpm = it.toFloat() }
        section("Permissions")
        perm("Notification access (see what's playing)", NowPlayingHub.isAccessGranted(this)) { go(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        perm("Display over other apps", Settings.canDrawOverlays(this)) { go(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        perm("Beat detection (\"Microphone\")", mic) { go(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        perm("Battery: let Luciel run in the background", false, "Open") { go(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        box.addView(Button(this).apply { text = "Open Luciel"; isAllCaps = false; setOnClickListener { startActivity(Intent(this@OverlaySettingsActivity, MainActivity::class.java).setAction(MainActivity.ACTION_EXT_MODE)); finish() } }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = 18.px })
    }

    private fun go(i: Intent) { try { startActivity(i) } catch (_: Throwable) {} }
    private fun label(s: String, size: Float, bold: Boolean, color: Int = Color.WHITE) = TextView(this).apply { text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, 4.px, 0, 4.px) }
    private fun section(s: String) = box.addView(label(s.uppercase(), 12f, true, 0xFF6CC8FF.toInt()).apply { setPadding(0, 22.px, 0, 6.px); letterSpacing = 0.12f })
    private fun switch(s: String, v: Boolean, on: (Boolean) -> Unit) = box.addView(Switch(this).apply { text = s; isChecked = v; setTextColor(Color.WHITE); textSize = 15f; setPadding(0, 8.px, 0, 8.px); setOnCheckedChangeListener { _, c -> on(c) } })
    private fun <T> choice(title: String, opts: List<Pair<String, T>>, cur: T, vertical: Boolean = false, on: (T) -> Unit) {
        box.addView(label(title, 15f, false))
        val group = RadioGroup(this).apply { orientation = if (vertical) RadioGroup.VERTICAL else RadioGroup.HORIZONTAL }
        opts.forEach { (name, value) ->
            group.addView(RadioButton(this).apply { text = name; setTextColor(Color.WHITE); isChecked = value == cur; id = android.view.View.generateViewId(); setOnClickListener { on(value) } })
        }
        box.addView(if (vertical) group else HorizontalScrollView(this).apply { addView(group) })
    }
    private fun slider(title: String, min: Int, max: Int, cur: Int, on: (Int) -> Unit) {
        val l = label("$title: $cur", 15f, false); box.addView(l)
        box.addView(SeekBar(this).apply { this.max = max - min; progress = cur - min; setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) { l.text = "$title: ${p + min}"; if (fromUser) on(p + min) }
            override fun onStartTrackingTouch(s: SeekBar?) {}
            override fun onStopTrackingTouch(s: SeekBar?) {}
        }) })
    }
    private fun perm(s: String, ok: Boolean, btn: String = "Turn on", open: () -> Unit) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, 6.px, 0, 6.px) }
        row.addView(label((if (ok) "✓ " else "") + s, 15f, false, if (ok) 0xFF7CF29C.toInt() else Color.WHITE), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        if (!ok) row.addView(Button(this).apply { text = btn; isAllCaps = false; background = GradientDrawable().apply { cornerRadius = 20f * dp; setColor(0x336CC8FF) }; setTextColor(Color.WHITE); setOnClickListener { open() } })
        box.addView(row)
    }
}
