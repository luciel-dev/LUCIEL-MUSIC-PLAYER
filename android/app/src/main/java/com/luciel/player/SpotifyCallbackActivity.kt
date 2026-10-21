package com.luciel.player

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.util.concurrent.Executors

/** catches luciel://spotify-callback?code=…&state=… after the Spotify sign-in, finishes it, and returns to Luciel */
class SpotifyCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent?.data
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
        if (uri != null && uri.scheme == "luciel" && uri.host == "spotify-callback") {
            val params = mapOf("code" to uri.getQueryParameter("code"), "state" to uri.getQueryParameter("state"), "error" to uri.getQueryParameter("error"))
            val app = applicationContext
            io.execute {
                val c = SpotifyConnect.get(app)
                val r = try { c.finish(params) } catch (e: Exception) { "error: " + e.javaClass.simpleName }
                DebugLog.add("spotify", "connect: $r")
                SpotifyConnect.notifyPage(r, c.status())
            }
        }
        finish()
    }
    companion object { private val io = Executors.newSingleThreadExecutor() }
}
