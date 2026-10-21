package com.luciel.player

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Playback debug log: every play / pause / stop with its reason, audio-focus changes and errors. Goes to logcat (tag
 * "LucielAudio") and to a ring buffer the page shows in Settings > Debug log (copyable), so a stray pause on a real
 * phone can be explained.
 */
object DebugLog {
    private const val MAX = 600
    private val lines = ArrayDeque<String>(MAX)
    private val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized fun add(src: String, msg: String) {
        Log.i("LucielAudio", "[$src] $msg")
        if (lines.size >= MAX) lines.removeFirst()
        lines.addLast(fmt.format(Date()) + " " + src + ": " + msg)
    }
    @Synchronized fun text(): String = lines.joinToString("\n")
    @Synchronized fun clear() = lines.clear()
}
