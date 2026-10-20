package com.luciel.player

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.io.FilterInputStream
import java.io.InputStream

/**
 * Everything the page loads comes from https://appassets.androidplatform.net (a secure, same-origin context, so
 * IndexedDB, Web Audio on <audio> and canvas reads all work):
 *   /…               bundled web app (assets/www)
 *   /_n/c?u=URI      a content:// audio file, with HTTP Range support so seeking works
 *   /_n/art?u=URI    album art thumbnail for a MediaStore track (JPEG)
 *   /_n/ext-art      cover of the song playing in Spotify / another player (JPEG)
 */
class LocalContent(private val ctx: Context) {
    private val assets = WebViewAssetLoader.Builder().addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(ctx)).build()

    fun intercept(req: WebResourceRequest): WebResourceResponse? {
        val url = req.url
        if (url.host != HOST) return null
        val path = url.path ?: "/"
        return try {
            when {
                path == "/_n/c" -> content(Uri.parse(url.getQueryParameter("u") ?: return notFound()), req.requestHeaders)
                path == "/_n/art" -> art(Uri.parse(url.getQueryParameter("u") ?: return notFound()))
                path == "/_n/ext-art" -> NowPlayingHub.artJpeg?.let { ok("image/jpeg", ByteArrayInputStream(it), it.size.toLong(), noCache = true) } ?: notFound()
                path == "/" || path.isEmpty() -> assets.shouldInterceptRequest(Uri.parse("https://$HOST/www/index.html"))
                else -> assets.shouldInterceptRequest(Uri.parse("https://$HOST/www$path"))?.also { fixMime(it, path) } ?: notFound()
            }
        } catch (e: SecurityException) { status(403, "Forbidden") } catch (e: Throwable) { android.util.Log.w("Luciel", "intercept $path", e); notFound() }
    }

    private fun fixMime(r: WebResourceResponse, path: String) {
        val ext = path.substringAfterLast('.', "").lowercase()
        MIME[ext]?.let { r.mimeType = it }
        r.responseHeaders = (r.responseHeaders ?: emptyMap()) + mapOf("Cache-Control" to "no-cache")
    }

    private fun content(uri: Uri, headers: Map<String, String>): WebResourceResponse {
        val afd = ctx.contentResolver.openAssetFileDescriptor(uri, "r") ?: return notFound()
        val size = afd.length.takeIf { it >= 0 } ?: afd.parcelFileDescriptor.statSize
        val mime = ctx.contentResolver.getType(uri)?.let { fixAudioMime(it, uri) } ?: "application/octet-stream"
        val range = RangeHeader.parse(headers.entries.firstOrNull { it.key.equals("Range", true) }?.value, size)
        val fis = FileInputStream(afd.fileDescriptor)
        val ch = fis.channel
        return if (range == null) {
            ch.position(afd.startOffset)
            WebResourceResponse(mime, null, 200, "OK", baseHeaders(size) + mapOf("Content-Length" to size.toString()), Limited(fis, size, afd))
        } else {
            val (s, e) = range[0] to range[1]
            ch.position(afd.startOffset + s)
            val len = e - s + 1
            WebResourceResponse(mime, null, 206, "Partial Content", baseHeaders(size) + mapOf("Content-Range" to "bytes $s-$e/$size", "Content-Length" to len.toString()), Limited(fis, len, afd))
        }
    }

    private fun fixAudioMime(m: String, uri: Uri): String = when {
        m == "audio/x-flac" -> "audio/flac"
        m == "application/ogg" -> "audio/ogg"
        m == "audio/mp4a-latm" -> "audio/mp4"
        m == "application/octet-stream" -> MIME[uri.lastPathSegment?.substringAfterLast('.', "")?.lowercase() ?: ""] ?: m
        else -> m
    }

    private fun art(uri: Uri): WebResourceResponse {
        val bmp: Bitmap? = if (Build.VERSION.SDK_INT >= 29) {
            try { ctx.contentResolver.loadThumbnail(uri, Size(512, 512), null) } catch (_: Throwable) { null }
        } else {
            // API 26-28: album art via the albumart table
            val albumId = ctx.contentResolver.query(uri, arrayOf(MediaStore.Audio.Media.ALBUM_ID), null, null, null)?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
            albumId?.let { id -> try { ctx.contentResolver.openInputStream(ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), id))?.use { android.graphics.BitmapFactory.decodeStream(it) } } catch (_: Throwable) { null } }
        }
        bmp ?: return notFound()
        val out = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.JPEG, 88, out)
        val b = out.toByteArray()
        return ok("image/jpeg", ByteArrayInputStream(b), b.size.toLong())
    }

    private fun baseHeaders(size: Long) = mapOf("Accept-Ranges" to "bytes", "Cache-Control" to "no-store", "Access-Control-Allow-Origin" to "https://$HOST", "X-Total-Size" to size.toString())
    private fun ok(mime: String, s: InputStream, len: Long, noCache: Boolean = false) =
        WebResourceResponse(mime, null, 200, "OK", mapOf("Content-Length" to len.toString(), "Cache-Control" to if (noCache) "no-store" else "max-age=600"), s)
    private fun notFound() = status(404, "Not Found")
    private fun status(code: Int, msg: String) = WebResourceResponse("text/plain", "utf-8", code, msg, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    /** stream that stops after [left] bytes and closes the descriptor */
    private class Limited(s: InputStream, private var left: Long, private val afd: android.content.res.AssetFileDescriptor) : FilterInputStream(s) {
        override fun read(): Int { if (left <= 0) return -1; val r = super.read(); if (r >= 0) left--; return r }
        override fun read(b: ByteArray, off: Int, len: Int): Int { if (left <= 0) return -1; val n = super.read(b, off, minOf(len.toLong(), left).toInt()); if (n > 0) left -= n; return n }
        override fun available(): Int = minOf(super.available().toLong(), left).toInt()
        override fun close() { try { super.close() } finally { try { afd.close() } catch (_: Throwable) {} } }
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        fun mediaUrl(uri: Uri) = "$ORIGIN/_n/c?u=" + Uri.encode(uri.toString())
        val MIME = mapOf(
            "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css", "html" to "text/html", "json" to "application/json",
            "webp" to "image/webp", "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "svg" to "image/svg+xml",
            "mp4" to "video/mp4", "webm" to "video/webm", "woff2" to "font/woff2", "woff" to "font/woff", "ttf" to "font/ttf", "webmanifest" to "application/manifest+json",
            "mp3" to "audio/mpeg", "flac" to "audio/flac", "ogg" to "audio/ogg", "oga" to "audio/ogg", "opus" to "audio/ogg", "m4a" to "audio/mp4", "aac" to "audio/aac", "wav" to "audio/wav",
        )
    }
}
