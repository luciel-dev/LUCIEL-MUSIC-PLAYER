package com.luciel.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Pictures from Spotify's public image CDNs (playlist / album covers from the Web API, "spotify:image:" covers from
 * the media session). Only those hosts, https only, size-capped, cached on disk by URL so a cover is fetched once.
 */
object ImageProxy {
    private const val MAX = 3 * 1024 * 1024
    private val HOSTS = Regex("^([a-z0-9-]+\\.)?scdn\\.co$|^[a-z0-9-]+\\.spotifycdn\\.com$")

    fun allowed(u: String): Boolean = try {
        val url = URL(u); url.protocol == "https" && HOSTS.matches(url.host.lowercase()) && url.userInfo == null && (url.port == -1 || url.port == 443)
    } catch (_: Exception) { false }

    private fun dir(ctx: Context) = File(ctx.cacheDir, "covers").apply { mkdirs() }
    private fun name(u: String) = MessageDigest.getInstance("SHA-1").digest(u.toByteArray()).joinToString("") { "%02x".format(it) }

    /** (mime, bytes) or null; blocking (call off the main thread: WebView requests already are) */
    fun get(ctx: Context, u: String): Pair<String, ByteArray>? {
        if (!allowed(u)) return null
        val f = File(dir(ctx), name(u))
        if (f.isFile && f.length() > 0) { f.setLastModified(System.currentTimeMillis()); return mime(f.readBytes()) }
        val r = mime(download(u) ?: return null) ?: return null
        try { val tmp = File(f.path + ".tmp"); tmp.writeBytes(r.second); tmp.renameTo(f); trim(ctx) } catch (_: Exception) {}
        return r
    }

    fun fetchBitmap(ctx: Context, u: String, max: Int): Bitmap? {
        val b = get(ctx, u)?.second ?: return null
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(b, 0, b.size, o)
        if (o.outWidth <= 0) return null
        var s = 1; while (o.outWidth / (s * 2) >= max && o.outHeight / (s * 2) >= max) s *= 2
        return BitmapFactory.decodeByteArray(b, 0, b.size, BitmapFactory.Options().apply { inSampleSize = s })
    }

    private fun mime(b: ByteArray): Pair<String, ByteArray>? = when {
        b.size > 3 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() -> "image/jpeg" to b
        b.size > 8 && b[0] == 0x89.toByte() && b[1] == 'P'.code.toByte() -> "image/png" to b
        b.size > 12 && String(b, 8, 4) == "WEBP" -> "image/webp" to b
        else -> null                                                // not a picture: never hand it to the page
    }

    private fun download(u: String): ByteArray? = try {
        val c = URL(u).openConnection() as HttpURLConnection
        c.instanceFollowRedirects = false; c.connectTimeout = 8000; c.readTimeout = 10000
        try {
            if (c.responseCode != 200) null
            else c.inputStream.use { ins ->
                val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(16384); var n = 0
                while (true) { val r = ins.read(buf); if (r < 0) break; n += r; if (n > MAX) return null; out.write(buf, 0, r) }
                out.toByteArray()
            }
        } finally { c.disconnect() }
    } catch (_: Exception) { null }

    private fun trim(ctx: Context) {
        val fs = dir(ctx).listFiles()?.filter { it.isFile } ?: return
        var total = fs.sumOf { it.length() }
        if (total < 40L * 1024 * 1024) return
        for (f in fs.sortedBy { it.lastModified() }) { if (total < 30L * 1024 * 1024) break; total -= f.length(); f.delete() }
    }
}
