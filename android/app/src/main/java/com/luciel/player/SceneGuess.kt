package com.luciel.player

/**
 * Media sessions don't carry a genre, so the "auto" scene is guessed from words in the title / album / artist,
 * then from the cover colours and tempo. Returns a genre-ish string that Luciel's own scene matcher understands
 * (art/scenes.json "genres"), plus a fallback scene id.
 */
object SceneGuess {
    private val KEYWORDS = listOf(
        "lofi" to listOf("lofi", "lo-fi", "lo fi", "chillhop", "study", "beats to"),
        "jazz" to listOf("jazz", "swing", "bebop", "bossa", "blue note", "quartet", "trio"),
        "classical" to listOf("symphony", "sonata", "concerto", "op.", "bwv", "k.", "orchestra", "piano", "nocturne", "prelude", "etude", "requiem", "mozart", "bach", "beethoven", "chopin", "debussy", "vivaldi"),
        "hip hop" to listOf("rap", "hip hop", "hip-hop", "trap", "drill", "freestyle", "remix feat", "boom bap"),
        "synthwave" to listOf("synthwave", "retrowave", "outrun", "80s", "vaporwave", "night drive"),
        "rock" to listOf("rock", "metal", "punk", "grunge", "live at", "unplugged", "core"),
        "electronic" to listOf("remix", "edit", "mix", "club", "edm", "house", "techno", "dubstep", "dnb", "drum and bass", "phonk", "rave", "bass boosted", "hardstyle"),
        "ambient" to listOf("ambient", "meditation", "sleep", "rain", "calm", "relax", "lullaby", "spa", "chill"),
        "pop" to listOf("pop", "radio edit", "single", "acoustic"),
        "sad" to listOf("sad", "tears", "cry", "lonely", "alone", "goodbye", "heartbreak", "broken"),
        "romantic" to listOf("love", "kiss", "heart", "valentine", "baby", "darling"),
    )

    /** a genre / mood word from metadata text, or null */
    fun genre(title: String?, album: String?, artist: String?): String? {
        val text = listOfNotNull(title, album, artist).joinToString(" ").lowercase()
        if (text.isBlank()) return null
        for ((g, words) in KEYWORDS) if (words.any { w -> Regex("(^|[^a-z])" + Regex.escape(w) + "($|[^a-z])").containsMatchIn(text) }) return g
        return null
    }

    /** scene ids that ship with Luciel (art/scenes.json) */
    fun sceneFor(genre: String?, family: String, bpm: Float, energy: Float): String = when (genre) {
        "lofi" -> "blue-lofi"; "jazz" -> "jazz"; "classical" -> "classical"; "hip hop" -> "hiphop"; "synthwave" -> "synthwave"
        "rock" -> "red-rock"; "electronic" -> if (family == "slime") "slime-rave" else "cyber"; "ambient" -> "aero-ambient"; "pop" -> "pop"
        "sad" -> "mood-sad"; "romantic" -> "mood-romantic"
        else -> when {
            bpm in 1f..85f && energy < 0.3f -> "mood-sleepy"
            bpm > 135f -> if (family == "slime") "slime-rave" else "mood-hype"
            family == "red" -> "red-rock"
            family == "slime" -> "slime-rave"
            family == "blue" -> "blue-lofi"
            else -> "aero-ambient"
        }
    }

    /** dance tier used by Lucielle's loops: <90 slow, 90-125 mid, >125 fast (same as the desktop app) */
    fun tier(bpm: Float): String = when { bpm <= 0f -> "mid"; bpm < 90f -> "slow"; bpm <= 125f -> "mid"; else -> "fast" }
}
