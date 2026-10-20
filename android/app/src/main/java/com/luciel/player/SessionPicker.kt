package com.luciel.player

/** Plain snapshot of one active MediaSession (kept free of Android types so it can be unit-tested). */
data class SessionInfo(
    val pkg: String,
    val playing: Boolean,
    val hasMetadata: Boolean = true,
    /** position in MediaSessionManager.getActiveSessions() order (0 = highest priority) */
    val order: Int = 0,
)

object SessionPicker {
    /**
     * Which outside player should Lucielle follow?
     *  - never our own app (local playback has its own path)
     *  - "Spotify only" restricts to com.spotify.music
     *  - a playing session beats a paused one; among playing ones Spotify wins, then the one we already follow, then system order
     *  - if nothing plays, keep following the last one (so the overlay can show "paused") if it still exists
     */
    fun pick(sessions: List<SessionInfo>, ownPkg: String, spotifyOnly: Boolean, lastPkg: String?): SessionInfo? {
        val ok = sessions.filter { it.pkg != ownPkg && !it.pkg.startsWith("$ownPkg.") && (!spotifyOnly || it.pkg == Prefs.SPOTIFY) }
        if (ok.isEmpty()) return null
        val playing = ok.filter { it.playing && it.hasMetadata }.ifEmpty { ok.filter { it.playing } }
        if (playing.isNotEmpty()) {
            return playing.minWith(compareBy<SessionInfo>({ if (it.pkg == Prefs.SPOTIFY) 0 else 1 }, { if (it.pkg == lastPkg) 0 else 1 }, { it.order }))
        }
        return ok.firstOrNull { it.pkg == lastPkg } ?: ok.filter { it.hasMetadata }.minByOrNull { it.order }
    }
}
