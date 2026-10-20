package com.luciel.player

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject

/** Device music library via MediaStore (READ_MEDIA_AUDIO on Android 13+, READ_EXTERNAL_STORAGE before). */
object LibraryScanner {
    val AUDIO_EXT = setOf("mp3", "mp2", "flac", "ogg", "oga", "opus", "m4a", "m4b", "mp4", "aac", "wav", "wave", "webm", "weba", "mka", "aif", "aiff", "wma", "alac")

    fun scan(ctx: Context): JSONArray {
        val out = JSONArray()
        val coll = if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val cols = mutableListOf(
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.TRACK, MediaStore.Audio.Media.YEAR, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.DATE_MODIFIED,
        )
        if (Build.VERSION.SDK_INT >= 29) cols += MediaStore.Audio.Media.RELATIVE_PATH
        if (Build.VERSION.SDK_INT >= 30) { cols += MediaStore.Audio.Media.GENRE; cols += MediaStore.Audio.Media.ALBUM_ARTIST }
        val sel = "${MediaStore.Audio.Media.IS_MUSIC} != 0 OR ${MediaStore.Audio.Media.DURATION} >= 45000"
        ctx.contentResolver.query(coll, cols.toTypedArray(), sel, null, "${MediaStore.Audio.Media.DATE_ADDED} DESC")?.use { c ->
            fun s(n: String) = c.getColumnIndex(n).let { if (it < 0 || c.isNull(it)) null else c.getString(it) }
            fun l(n: String) = c.getColumnIndex(n).let { if (it < 0 || c.isNull(it)) 0L else c.getLong(it) }
            while (c.moveToNext()) {
                val id = l(MediaStore.Audio.Media._ID)
                val uri = ContentUris.withAppendedId(coll, id)
                val name = s(MediaStore.Audio.Media.DISPLAY_NAME) ?: "track-$id"
                val artist = s(MediaStore.Audio.Media.ARTIST)?.takeIf { it != "<unknown>" }
                out.put(JSONObject().apply {
                    put("uri", uri.toString()); put("url", LocalContent.mediaUrl(uri)); put("art", LocalContent.ORIGIN + "/_n/art?u=" + Uri.encode(uri.toString()))
                    put("name", name); put("size", l(MediaStore.Audio.Media.SIZE)); put("mime", s(MediaStore.Audio.Media.MIME_TYPE) ?: "")
                    put("title", s(MediaStore.Audio.Media.TITLE) ?: ""); put("artist", artist ?: ""); put("album", s(MediaStore.Audio.Media.ALBUM) ?: "")
                    put("albumArtist", s("album_artist") ?: ""); put("genre", s("genre") ?: "")
                    val tr = l(MediaStore.Audio.Media.TRACK); put("track", if (tr > 0) (tr % 1000).toString() else "")
                    val y = l(MediaStore.Audio.Media.YEAR); put("year", if (y > 0) y.toString() else "")
                    put("durationMs", l(MediaStore.Audio.Media.DURATION)); put("added", l(MediaStore.Audio.Media.DATE_ADDED) * 1000)
                    put("rel", (s("relative_path") ?: "") + name)
                })
            }
        }
        return out
    }

    /** files picked with the system picker (SAF) or shared to us */
    fun describe(ctx: Context, uris: List<Uri>): JSONArray {
        val out = JSONArray()
        for (u in uris) {
            var name = u.lastPathSegment ?: "audio"; var size = 0L
            try { ctx.contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) { c.getString(0)?.let { name = it }; if (!c.isNull(1)) size = c.getLong(1) } } } catch (_: Throwable) {}
            out.put(JSONObject().apply {
                put("uri", u.toString()); put("url", LocalContent.mediaUrl(u)); put("name", name); put("size", size)
                put("mime", ctx.contentResolver.getType(u) ?: ""); put("rel", name)
                if (u.authority == "media") put("art", LocalContent.ORIGIN + "/_n/art?u=" + Uri.encode(u.toString()))
            })
        }
        return out
    }

    /** a folder picked with ACTION_OPEN_DOCUMENT_TREE: every audio file (or every file, for visual packs) inside */
    fun walkTree(ctx: Context, tree: Uri, audioOnly: Boolean, limit: Int = 5000): JSONArray {
        val out = JSONArray()
        val root = DocumentFile.fromTreeUri(ctx, tree) ?: return out
        fun walk(d: DocumentFile, path: String) {
            for (f in d.listFiles()) {
                if (out.length() >= limit) return
                val n = f.name ?: continue
                if (f.isDirectory) walk(f, "$path$n/")
                else if (!audioOnly || n.substringAfterLast('.', "").lowercase() in AUDIO_EXT) out.put(JSONObject().apply {
                    put("uri", f.uri.toString()); put("url", LocalContent.mediaUrl(f.uri)); put("name", n); put("size", f.length()); put("mime", f.type ?: ""); put("rel", "$path$n")
                })
            }
        }
        walk(root, (root.name ?: "Folder") + "/")
        return out
    }
}
