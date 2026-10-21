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

/**
 * "Spotify overlay" setup + settings. Opened from the phone sheet, the permission guide, or a long-press on the card.
 * One clear on/off switch, a live status line (Spotify found? what's playing?), one card per permission with a plain
 * reason, a button to the exact system screen and a tick that updates when you come back, then the card style.
 */
class OverlaySettingsActivity : ComponentActivity() {
    private val prefs by lazy { Prefs.get(this) }
    private val dp by lazy { resources.displayMetrics.density }
    private lateinit var box: LinearLayout
    private var statusTitle: TextView? = null
    private var statusHint: TextView? = null
    private var statusBtn: Button? = null
    private val Int.px get() = (this * dp).toInt()
    private val trackListener: (ExtTrack?) -> Unit = { runOnUiThread { updateStatus() } }
    private val micAsk = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok ->
        DebugLog.add("overlay", "beat-sync permission " + if (ok) "granted" else "refused")
        if (ok) NowPlayingHub.restartBeats()
        render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#141E2B")) }
        box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(box, MATCH_PARENT, WRAP_CONTENT)
        setContentView(scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, ins -> val b = ins.getInsets(WindowInsetsCompat.Type.systemBars()); v.setPadding(20.px + b.left, 16.px + b.top, 20.px + b.right, 16.px + b.bottom); ins }
    }

    // ticks are re-checked every time you come back from a system screen
    override fun onResume() { super.onResume(); NowPlayingHub.listeners.add(trackListener); render() }
    override fun onPause() { super.onPause(); NowPlayingHub.listeners.remove(trackListener) }

    private fun changed() { OverlayController.instance?.refresh() }

    private val listenerOk get() = NowPlayingHub.isAccessGranted(this)
    private val overlayOk get() = Settings.canDrawOverlays(this)
    private val micOk get() = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    private val spotifyInstalled get() = try { packageManager.getLaunchIntentForPackage(Prefs.SPOTIFY) != null } catch (_: Throwable) { false }

    /** the status line: is Spotify there, is it playing, what's on, and what to do next */
    data class Status(val title: String, val hint: String, val action: String?, val good: Boolean)
    private fun status(): Status {
        val t = NowPlayingHub.current
        return when {
            !prefs.overlayEnabled -> Status("Spotify overlay is off", "Turn it on above to see Lucielle dance over Spotify.", null, false)
            !listenerOk -> Status("Can't see Spotify yet", "Finish step 1 below so Luciel can see what Spotify is playing.", null, false)
            t != null && t.pkg == Prefs.SPOTIFY && t.playing -> Status("● Spotify detected – playing", listOf(t.title, t.artist).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "Unknown song" } +
                if (!overlayOk) "\nFinish step 2 to show the overlay." else "\nThe overlay shows when you switch to Spotify or any other app.", "Open Spotify", true)
            t != null && t.pkg == Prefs.SPOTIFY -> Status("Spotify detected – paused", (t.title.ifBlank { "Spotify" }) + " is paused. Press play in Spotify (or ▶ on the card) and Lucielle starts dancing.", "Open Spotify", true)
            t != null && t.playing -> Status("${t.appLabel} is playing", listOf(t.title, t.artist).filter { it.isNotBlank() }.joinToString(" · ") +
                if (prefs.spotifyOnly) "\n“Spotify only” is on, so the overlay ignores it." else "\nThe overlay follows it too (turn on “Spotify only” below to ignore other players).", if (spotifyInstalled) "Open Spotify" else null, true)
            !spotifyInstalled -> Status("Spotify isn't installed", "Install Spotify, or play music in another player – the overlay works with any app that shows a media notification.", "Get Spotify", false)
            else -> Status("Spotify isn't playing", "Open Spotify and play a song – this line updates by itself.", "Open Spotify", false)
        }
    }
    private fun updateStatus() {
        val st = status()
        statusTitle?.apply { text = st.title; setTextColor(if (st.good) 0xFF7CF29C.toInt() else 0xFFFFD27A.toInt()) }
        statusHint?.text = st.hint
        statusBtn?.apply { visibility = if (st.action != null) android.view.View.VISIBLE else android.view.View.GONE; text = st.action ?: "" }
    }
    private fun openSpotify() {
        val i = packageManager.getLaunchIntentForPackage(Prefs.SPOTIFY)
        if (i != null) go(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        else go(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${Prefs.SPOTIFY}")).also { if (it.resolveActivity(packageManager) == null) it.data = Uri.parse("https://play.google.com/store/apps/details?id=${Prefs.SPOTIFY}") })
    }

    private fun render() {
        box.removeAllViews()
        box.addView(label("Spotify overlay", 26f, true))
        box.addView(label("Lucielle dances on top of Spotify, with the song, cover and play / pause / skip buttons.", 14f, false, 0xAAFFFFFF.toInt()))

        // one clear switch
        val on = Switch(this).apply {
            text = if (prefs.overlayEnabled) "Spotify overlay: ON" else "Spotify overlay: OFF"; isChecked = prefs.overlayEnabled
            setTextColor(Color.WHITE); textSize = 18f; typeface = Typeface.DEFAULT_BOLD; setPadding(16.px, 14.px, 16.px, 14.px)
            background = rounded(0xFF1E3045.toInt())
            contentDescription = "Spotify overlay on or off"
            setOnCheckedChangeListener { _, c -> prefs.overlayEnabled = c; DebugLog.add("overlay", "Spotify overlay switched " + if (c) "on" else "off"); changed(); render() }
        }
        box.addView(on, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = 14.px })

        // live status line
        val sCard = card()
        statusTitle = label("", 16f, true).also { sCard.addView(it) }
        statusHint = label("", 14f, false, 0xCCFFFFFF.toInt()).also { sCard.addView(it) }
        statusBtn = pill("Open Spotify") { openSpotify() }.also { sCard.addView(it, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = 6.px }) }
        box.addView(sCard, cardLp())
        updateStatus()

        // setup steps
        val need = listOf(listenerOk, overlayOk).count { it }
        section(if (need == 2) "Setup ✓ all set" else "Setup · $need of 2 required steps done")
        permCard(1, "See what's playing", "Notification access",
            "Lets Luciel read the song name, cover and play/pause from Spotify's notification, and send play / pause / skip back. Nothing leaves your phone.",
            listenerOk, "Open notification access") { openListenerSettings() }
        permCard(2, "Show over other apps", "Display over other apps",
            "Needed to float Lucielle on top of Spotify. Find Luciel in the list and switch it on.",
            overlayOk, "Open “Display over other apps”") { go(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) }
        val canAsk = !prefs.micAsked || shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)
        permCard(3, "Dance on the real beat (optional)", "Microphone",
            "Android calls the music-level reader “Microphone”. Luciel only reads Spotify's sound levels to find the beat – it never records you or your room.",
            micOk, if (canAsk) "Allow beat sync" else "Open app permissions", optional = true,
            fallback = if (micOk) null else "Without it Lucielle dances to a steady ${prefs.fallbackBpm.toInt()} BPM – tap the ♪ chip on the card a few times to match the song.") {
            if (canAsk) { prefs.micAsked = true; micAsk.launch(Manifest.permission.RECORD_AUDIO) } else go(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }

        // card style, same three modes as Luciel's own floating player
        section("Card style")
        choice("", listOf("Compact" to "compact", "Large" to "large", "Bubble" to "bubble"), prefs.overlayMode) { prefs.overlayMode = it; changed() }
        box.addView(label("Drag it anywhere – it remembers where you leave it. Tap the cover or title to open Spotify, tap Lucielle to open Luciel, ⤢ switches size, – shrinks to a bubble, ✕ hides it for this song. Long-press opens this screen.", 13f, false, 0x99FFFFFF.toInt()))
        box.addView(label("Only one floating window at a time: while Luciel's own player is floating, the Spotify card waits and comes back when it closes.", 13f, false, 0x99FFFFFF.toInt()))

        section("More options")
        switch("Spotify only (ignore other players)", prefs.spotifyOnly) { prefs.spotifyOnly = it; NowPlayingHub.refresh(); changed(); updateStatus() }
        choice("Hide after the music pauses", listOf("Never" to 0, "10 s" to 10, "20 s" to 20, "1 min" to 60), prefs.autoHideSec) { prefs.autoHideSec = it; changed() }
        slider("Opacity", 30, 100, prefs.overlayOpacity) { prefs.overlayOpacity = it; changed() }
        val scenes = LucielleAssets(this).scenes.filter { it.kind != "full" }
        choice("Scene", listOf("Auto (cover colours, title words, tempo)" to "auto") + scenes.map { it.name to it.id }, prefs.overlayScene, vertical = true) { prefs.overlayScene = it; changed() }
        switch("Listen to the music's levels (needs step 3)", prefs.useVisualizer) { prefs.useVisualizer = it; NowPlayingHub.restartBeats() }
        if (micOk) box.addView(label(when (NowPlayingHub.beats.vizState) {
            "silent" -> "This phone gives the level reader silence (common with some players) – using the steady tempo below."
            "unavailable" -> "This phone doesn't allow the level reader – using the steady tempo below."
            else -> "When the level reader can't hear anything, Lucielle falls back to the steady tempo below."
        }, 13f, false, 0x99FFFFFF.toInt()))
        slider("Steady tempo (BPM)", 60, 200, prefs.fallbackBpm.toInt()) { prefs.fallbackBpm = it.toFloat() }
        perm("Battery: let Luciel run in the background", false, "Open") { go(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
        box.addView(Button(this).apply { text = "Open Luciel"; isAllCaps = false; setOnClickListener { startActivity(Intent(this@OverlaySettingsActivity, MainActivity::class.java).setAction(MainActivity.ACTION_EXT_MODE)); finish() } }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = 18.px })
    }

    private fun openListenerSettings() {
        // the exact page for Luciel's listener where the phone supports it, else the list
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, android.content.ComponentName(this, MediaWatchService::class.java).flattenToString())
            if (i.resolveActivity(packageManager) != null) { go(i); return }
        }
        go(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun rounded(color: Int, stroke: Int = 0) = GradientDrawable().apply { cornerRadius = 16f * dp; setColor(color); if (stroke != 0) setStroke(2.px, stroke) }
    private fun card() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(16.px, 12.px, 16.px, 14.px); background = rounded(0xFF1B2A3B.toInt()) }
    private fun cardLp() = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = 10.px }
    private fun pill(s: String, primary: Boolean = true, on: () -> Unit) = Button(this).apply {
        text = s; isAllCaps = false; textSize = 14f; setTextColor(Color.WHITE); minHeight = 44.px
        background = GradientDrawable().apply { cornerRadius = 22f * dp; setColor(if (primary) 0xFF2D7FD3.toInt() else 0x336CC8FF) }
        setPadding(18.px, 0, 18.px, 0); setOnClickListener { on() }
    }
    private fun permCard(n: Int, title: String, sysName: String, why: String, ok: Boolean, btn: String, optional: Boolean = false, fallback: String? = null, open: () -> Unit) {
        val c = card().apply { background = rounded(0xFF1B2A3B.toInt(), if (ok) 0xFF3FBF6A.toInt() else if (optional) 0x33FFFFFF else 0xFF6CC8FF.toInt()) }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(label("$n", 15f, true, Color.WHITE).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (ok) 0xFF3FBF6A.toInt() else 0xFF2D7FD3.toInt()) }; setPadding(0, 0, 0, 0) }, LinearLayout.LayoutParams(28.px, 28.px).apply { rightMargin = 10.px })
        head.addView(label(title, 16f, true), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        head.addView(label(if (ok) "✓ Done" else if (optional) "Optional" else "Needed", 13f, true, if (ok) 0xFF7CF29C.toInt() else if (optional) 0x99FFFFFF.toInt() else 0xFFFFD27A.toInt()).apply { contentDescription = "$title: " + if (ok) "done" else "not done" })
        c.addView(head)
        c.addView(label(why, 14f, false, 0xCCFFFFFF.toInt()))
        if (!ok) {
            c.addView(label("In Android settings this is called “$sysName”.", 12f, false, 0x88FFFFFF.toInt()))
            c.addView(pill(btn) { DebugLog.add("overlay", "setup: opening $sysName"); open() }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = 6.px })
        }
        if (fallback != null) c.addView(label(fallback, 13f, false, 0xFFFFD27A.toInt()).apply { setPadding(0, 8.px, 0, 0) })
        box.addView(c, cardLp())
    }

    private fun go(i: Intent) { try { startActivity(i) } catch (_: Throwable) {} }
    private fun label(s: String, size: Float, bold: Boolean, color: Int = Color.WHITE) = TextView(this).apply { text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, 4.px, 0, 4.px) }
    private fun section(s: String) = box.addView(label(s.uppercase(), 12f, true, 0xFF6CC8FF.toInt()).apply { setPadding(0, 22.px, 0, 6.px); letterSpacing = 0.12f })
    private fun switch(s: String, v: Boolean, on: (Boolean) -> Unit) = box.addView(Switch(this).apply { text = s; isChecked = v; setTextColor(Color.WHITE); textSize = 15f; setPadding(0, 8.px, 0, 8.px); setOnCheckedChangeListener { _, c -> on(c) } })
    private fun <T> choice(title: String, opts: List<Pair<String, T>>, cur: T, vertical: Boolean = false, on: (T) -> Unit) {
        if (title.isNotEmpty()) box.addView(label(title, 15f, false))
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
