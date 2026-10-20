// Test fixture only (never shipped): a tiny music app with a real MediaSession + audible beat, used on the emulator to
// stand in for Spotify. Install with -PtpId=com.spotify.music to exercise the "Spotify" path of the overlay.
plugins { id("com.android.application") }
android {
    namespace = "com.luciel.testplayer"
    compileSdk = 37
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = (project.findProperty("tpId") as String?) ?: "com.luciel.testplayer"
        minSdk = 26; targetSdk = 37; versionCode = 1; versionName = "test"
    }
    lint { abortOnError = false; checkReleaseBuilds = false }
}
