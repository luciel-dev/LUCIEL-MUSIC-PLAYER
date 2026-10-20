package com.luciel.player

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** One permission per screen, in plain words, each skippable. Everything degrades gracefully when declined. */
class OnboardingActivity : ComponentActivity() {
    private data class Step(val key: String, val title: String, val body: String, val button: String, val granted: () -> Boolean, val ask: () -> Unit, val skippable: Boolean = true)

    private val steps by lazy { buildSteps() }
    private var index = 0
    private lateinit var root: LinearLayout
    private val dp by lazy { resources.displayMetrics.density }
    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply { isFillViewport = true; setBackgroundColor(Color.parseColor("#141E2B")) }
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        scroll.addView(root, MATCH_PARENT, WRAP_CONTENT)
        setContentView(scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, ins -> val b = ins.getInsets(WindowInsetsCompat.Type.systemBars()); v.setPadding((24 * dp).toInt() + b.left, (24 * dp).toInt() + b.top, (24 * dp).toInt() + b.right, (24 * dp).toInt() + b.bottom); ins }
        if (savedInstanceState != null) index = savedInstanceState.getInt("i")
        render()
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); outState.putInt("i", index) }
    override fun onResume() { super.onResume(); render() }

    private fun perm(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
    private val audioPerm = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

    private fun buildSteps(): List<Step> {
        val s = mutableListOf<Step>()
        s += Step("welcome", "Hi, I'm Lucielle ✦",
            "Luciel plays the music on your phone with themes, an equalizer and me dancing to the beat.\n\n" +
            "I can also dance along when you play music in Spotify (or YouTube Music and other players).\n\n" +
            "Next I'll ask for a few permissions, one at a time. You can skip any of them and change your mind later.",
            "Let's go", { true }, { next() }, skippable = false)
        s += Step("audio", "Your music",
            "Lets Luciel find the songs saved on this phone and build your library (artists, albums, playlists).\n\n" +
            "Your files never leave the phone.\n\nIf you skip this, you can still open songs one by one with the file picker.",
            "Allow music access", { perm(audioPerm) }, { permLauncher.launch(audioPerm) })
        if (Build.VERSION.SDK_INT >= 33) s += Step("notif", "Player controls",
            "Shows play / pause / skip in your notification shade and on the lock screen while Luciel plays, so you can control it without opening the app.\n\n" +
            "If you skip this, music still plays, but Android may hide the controls.",
            "Allow notifications", { perm(Manifest.permission.POST_NOTIFICATIONS) }, { permLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) })
        s += Step("listener", "Dance to Spotify",
            "To see what Spotify (or another player) is playing, Android requires \"Notification access\".\n\n" +
            "Luciel only reads the song title, artist, cover and play / pause state from the media controls. It ignores your other notifications and messages and stores nothing.\n\n" +
            "On the next screen, find Luciel, switch it on and confirm. Then come back here.",
            "Open notification access", { NowPlayingHub.isAccessGranted(this) }, { open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) })
        s += Step("overlay", "Float over other apps",
            "Lets a small Lucielle card float on top of Spotify and other apps while music plays: drag it anywhere, make it bigger or smaller, shrink it to a bubble, tap to open Luciel, long-press for settings.\n\n" +
            "Android calls this \"Display over other apps\". Find Luciel on the next screen and switch it on.\n\nIf you skip this, the Spotify visuals still play inside the Luciel app.",
            "Allow floating Lucielle", { Settings.canDrawOverlays(this) }, { open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) })
        s += Step("mic", "Feel the beat",
            "Android lists this as \"Microphone\", but Luciel uses it only for the system audio visualizer: it measures the music that is already playing from your phone so I dance on the real beat and the scene pulses with the bass.\n\n" +
            "Nothing is recorded, saved or sent anywhere.\n\nIf you skip this (or your phone blocks it), I dance to a steady tempo instead. You can tap the tempo to match the song.",
            "Allow beat detection", { perm(Manifest.permission.RECORD_AUDIO) }, { permLauncher.launch(Manifest.permission.RECORD_AUDIO) })
        s += Step("done", "All set!", "", "Start Luciel", { true }, { finishOnboarding() }, skippable = false)
        return s
    }

    private fun open(i: Intent) { try { startActivity(i) } catch (_: Throwable) { try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (_: Throwable) {} } }
    private fun next() { if (index < steps.size - 1) { index++; render() } else finishOnboarding() }
    private fun finishOnboarding() { Prefs.get(this).onboarded = true; finish() }

    private fun render() {
        if (!::root.isInitialized) return
        root.removeAllViews()
        val st = steps[index]
        // progress dots
        val dots = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        steps.indices.forEach { i -> dots.addView(View(this).apply { background = pill(if (i == index) 0xFF6CC8FF.toInt() else 0x44FFFFFF) }, LinearLayout.LayoutParams((if (i == index) 22 else 8).px, 8.px).apply { setMargins(4.px, 0, 4.px, 0) }) }
        root.addView(dots, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = 18.px })
        val img = ImageView(this).apply {
            val path = if (st.key == "welcome" || st.key == "done") "www/icons/icon-512.png" else "www/mascot/poses/" + (when (st.key) { "audio" -> "music"; "notif" -> "happy"; "listener" -> "love"; "overlay" -> "flying"; "mic" -> "music"; else -> "idle" }) + ".webp"
            try { assets.open(path).use { setImageBitmap(BitmapFactory.decodeStream(it)) } } catch (_: Throwable) {}
            adjustViewBounds = true
        }
        root.addView(img, LinearLayout.LayoutParams(170.px, 170.px).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = 10.px })
        root.addView(text(st.title, 26f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER })
        val granted = st.key != "welcome" && st.key != "done" && st.granted()
        if (st.key == "done") root.addView(summary()) else {
            if (granted) root.addView(text("✓ Allowed", 15f, 0xFF7CF29C.toInt(), bold = true).apply { gravity = Gravity.CENTER; setPadding(0, 8.px, 0, 0) })
            root.addView(text(st.body, 16f, 0xDDFFFFFF.toInt()).apply { setPadding(0, 16.px, 0, 20.px); setLineSpacing(0f, 1.18f) })
        }
        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        root.addView(button(if (granted) "Next" else st.button, primary = true) { if (granted) next() else st.ask() })
        if (st.skippable && !granted) root.addView(button("Not now", primary = false) { next() })
        if (index > 0 && st.key != "done") root.addView(button("Back", primary = false) { index--; render() })
    }

    private fun summary(): View {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 18.px, 0, 0) }
        steps.filter { it.key != "welcome" && it.key != "done" }.forEach { s ->
            val ok = s.granted()
            box.addView(text((if (ok) "✓  " else "–  ") + s.title + (if (ok) "" else "  (skipped)"), 16f, if (ok) 0xFF7CF29C.toInt() else 0x99FFFFFF.toInt()).apply { setPadding(0, 6.px, 0, 6.px) })
        }
        box.addView(text("You can change any of these later from Luciel's theme panel (Android section) or Android Settings.\n\n" +
            "Tip: some phones (Samsung, Xiaomi, OnePlus...) close apps in the background to save battery. If the floating Lucielle stops appearing, set Luciel's battery use to \"Unrestricted\".", 14f, 0xBBFFFFFF.toInt()).apply { setPadding(0, 16.px, 0, 8.px); setLineSpacing(0f, 1.15f) })
        box.addView(button("Battery settings", primary = false) { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) })
        return box
    }

    private val Int.px get() = (this * dp).toInt()
    private fun pill(c: Int) = GradientDrawable().apply { cornerRadius = 99f * dp; setColor(c) }
    private fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply { text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD }
    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 16f; setTextColor(if (primary) Color.parseColor("#06223A") else Color.WHITE)
        background = GradientDrawable().apply { cornerRadius = 28f * dp; if (primary) setColor(0xFF6CC8FF.toInt()) else { setColor(0x22FFFFFF); setStroke(1.px, 0x44FFFFFF) } }
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, 52.px).apply { topMargin = 10.px }
    }
}
