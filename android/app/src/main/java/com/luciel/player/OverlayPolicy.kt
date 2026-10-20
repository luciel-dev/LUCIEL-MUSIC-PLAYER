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

/**
 * Audio-focus bookkeeping for the WebView player (pure: the service turns the returned commands into page commands).
 * Fixes: after a transient loss (phone call) we no longer think we still hold focus, so a play press during the call
 * asks again and stays paused if Android says no; a manual pause/play cancels the automatic resume.
 */
class FocusLogic {
    var hasFocus = false; private set
    var resumeOnGain = false; private set

    /** result of AudioManager.requestAudioFocus for a play; false = keep paused */
    fun onRequest(granted: Boolean): Boolean { hasFocus = granted; if (granted) resumeOnGain = false; return granted }
    /** does a play need a fresh focus request? */
    fun needsRequest() = !hasFocus
    /** the user (UI, notification, headset) paused: don't auto-resume later */
    fun onUserPause() { resumeOnGain = false }

    /** AudioManager focus change -> page commands */
    fun onChange(change: Int, playing: Boolean): List<Pair<String, Long>> = when (change) {
        LOSS -> { hasFocus = false; resumeOnGain = false; listOf("pause" to 0L) }
        LOSS_TRANSIENT -> { hasFocus = false; resumeOnGain = playing || resumeOnGain; listOf("pause" to 0L) }
        LOSS_TRANSIENT_CAN_DUCK -> listOf("duck" to 1L)
        GAIN -> { hasFocus = true; val r = resumeOnGain; resumeOnGain = false; listOf("duck" to 0L) + (if (r) listOf("play" to 0L) else emptyList()) }
        else -> emptyList()
    }

    companion object {
        // android.media.AudioManager constants (kept here so the logic is testable without Android)
        const val GAIN = 1; const val LOSS = -1; const val LOSS_TRANSIENT = -2; const val LOSS_TRANSIENT_CAN_DUCK = -3
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
