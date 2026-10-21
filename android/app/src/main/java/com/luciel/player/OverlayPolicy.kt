package com.luciel.player

/**
 * Which floating window may be on screen: Luciel's own floater (local playback) or the Lucielle card for an outside
 * player (Spotify ...). Only one at a time; Luciel's own playback wins while it plays. Pure logic, unit-tested.
 */
object OverlayPolicy {
    enum class Show { NONE, OWN, EXT }

    data class Input(
        val canDraw: Boolean,              // "Display over other apps" granted
        val appInFront: Boolean,           // Luciel's own window is visible (the full player is right there)
        val ownHasTrack: Boolean,
        val ownPlaying: Boolean,
        val poppedOut: Boolean,            // the user pressed "Pop out" (stays until closed)
        val autoFloater: Boolean,          // setting: pop out automatically when leaving the app while music plays
        val ownShowing: Boolean,           // the floater is already up (pausing from it must not make it vanish)
        val ownDismissed: Boolean,         // closed with × (comes back on the next play / pop out)
        val extWanted: Boolean,            // the outside-player card is enabled and has a track
        val extPlaying: Boolean,
    )

    /** is Luciel's own floater a candidate at all? */
    fun ownCandidate(i: Input): Boolean =
        i.canDraw && !i.appInFront && i.ownHasTrack && !i.ownDismissed &&
            (i.poppedOut || (i.autoFloater && (i.ownPlaying || i.ownShowing)))

    fun decide(i: Input): Show {
        if (!i.canDraw || i.appInFront) return Show.NONE
        val own = ownCandidate(i)
        return when {
            own && i.ownPlaying -> Show.OWN                   // Luciel playing: always ours
            i.extWanted && i.extPlaying -> Show.EXT           // Spotify playing while Luciel is paused
            own -> Show.OWN                                   // paused but popped out / already up
            i.extWanted -> Show.EXT                           // paused outside player (the card auto-hides itself)
            else -> Show.NONE
        }
    }
}

/** Media3 seek commands -> page commands (Previous restarts the song after 3 s, like every player). */
object SeekMap {
    // Player.COMMAND_* values
    const val SEEK_IN_CURRENT = 5; const val SEEK_TO_PREVIOUS_MEDIA_ITEM = 6; const val SEEK_TO_PREVIOUS = 7
    const val SEEK_TO_NEXT_MEDIA_ITEM = 8; const val SEEK_TO_NEXT = 9; const val SEEK_TO_MEDIA_ITEM = 10

    fun command(seekCommand: Int, mediaItemIndex: Int, currentIndex: Int, positionMs: Long): Pair<String, Long> = when (seekCommand) {
        SEEK_TO_NEXT, SEEK_TO_NEXT_MEDIA_ITEM -> "next" to 0L
        SEEK_TO_PREVIOUS, SEEK_TO_PREVIOUS_MEDIA_ITEM -> if (mediaItemIndex == currentIndex) "seek" to 0L else "prev" to 0L
        SEEK_TO_MEDIA_ITEM -> when { mediaItemIndex > currentIndex -> "next" to 0L; mediaItemIndex < currentIndex -> "prev" to 0L; else -> "seek" to positionMs.coerceAtLeast(0) }
        else -> "seek" to positionMs.coerceAtLeast(0)
    }
}

/**
 * 1.1.2 closing rules for Luciel's own floater (pure, unit-tested). ✕ / long-press on the bubble / the bottom dismiss
 * target / the notification's "Close overlay" close it for good: it stays closed until Pop out (or turning the
 * auto pop-out setting back on). Pop out is one-shot: coming back to the app ends it, so it doesn't reappear every
 * time you leave. Closing never touches playback.
 */
object CloseRules {
    data class Floater(val poppedOut: Boolean = false, val closed: Boolean = false, val autoHidden: Boolean = false) {
        val dismissed get() = closed || autoHidden
    }
    fun close(s: Floater) = Floater(poppedOut = false, closed = true, autoHidden = false)
    fun popOut(s: Floater) = Floater(poppedOut = true, closed = false, autoHidden = false)
    fun appFront(s: Floater) = s.copy(poppedOut = false)
    fun playStarted(s: Floater) = s.copy(autoHidden = false)            // a closed floater stays closed
    fun pausedLong(s: Floater) = if (s.poppedOut) s else s.copy(autoHidden = true)
    fun autoSettingOn(s: Floater) = s.copy(closed = false)
    fun trackGone(s: Floater) = s.copy(poppedOut = false)

    /** the Spotify card: ✕ turns the overlay off (pref), Pop out / the Spotify tab switch turn it on again */
    fun cardEnabledAfterClose() = false
    /** commands a close action may send to any player: none (closing must never stop the music) */
    val playbackCommandsOnClose: List<String> = emptyList()
}
