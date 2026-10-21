package com.luciel.player

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/**
 * Last fallback of the playback chain: songs the WebView can't decode are decoded with the phone's own codecs
 * (MediaExtractor + MediaCodec, the same decoders Media3/ExoPlayer uses) into a WAV copy in the cache, which the page
 * then plays through its normal path (EQ, visualizer and BPM keep working).
 */
object AudioDecoder {
    private const val MAX_BYTES = 700L * 1024 * 1024        // ~1 h of 16-bit stereo 48 kHz

    fun dir(ctx: Context) = File(ctx.cacheDir, "decoded")

    fun toWav(ctx: Context, uri: Uri): File {
        val d = dir(ctx).apply { mkdirs() }
        val out = File(d, sha1(uri.toString()) + ".wav")
        if (out.length() > 44) { out.setLastModified(System.currentTimeMillis()); return out }
        d.listFiles()?.filter { it.name.endsWith(".wav") }?.sortedBy { it.lastModified() }?.dropLast(4)?.forEach { it.delete() }
        val ex = MediaExtractor()
        val tmp = File(d, out.name + ".part")
        var codec: MediaCodec? = null
        try {
            try { ex.setDataSource(ctx, uri, null) } catch (e: Throwable) { throw IOException("the phone doesn't recognise this file as audio (${e.message})") }
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: throw IOException("no audio track in this file")
            ex.selectTrack(track)
            val fmt = ex.getTrackFormat(track)
            val mime = fmt.getString(MediaFormat.KEY_MIME)!!
            val c = try { MediaCodec.createDecoderByType(mime) } catch (e: Throwable) { throw IOException("this phone has no decoder for $mime") }
            codec = c
            c.configure(fmt, null, null, 0); c.start()
            var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE); var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var float = false
            var written = 0L
            BufferedOutputStream(FileOutputStream(tmp), 1 shl 16).use { os ->
                os.write(ByteArray(44))
                val info = MediaCodec.BufferInfo()
                var inDone = false; var outDone = false
                var conv = ByteArray(0)
                while (!outDone) {
                    if (!inDone) {
                        val i = c.dequeueInputBuffer(10_000)
                        if (i >= 0) {
                            val buf = c.getInputBuffer(i)!!
                            val n = ex.readSampleData(buf, 0)
                            if (n < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inDone = true }
                            else { c.queueInputBuffer(i, 0, n, ex.sampleTime, 0); ex.advance() }
                        }
                    }
                    val o = c.dequeueOutputBuffer(info, 10_000)
                    when {
                        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val f = c.outputFormat
                            rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                            float = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                        }
                        o >= 0 -> {
                            val buf = c.getOutputBuffer(o)!!
                            buf.position(info.offset); buf.limit(info.offset + info.size)
                            if (float) {
                                val fb = buf.order(ByteOrder.nativeOrder()).asFloatBuffer()
                                val n = fb.remaining(); if (conv.size < n * 2) conv = ByteArray(n * 2)
                                for (k in 0 until n) { val v = (fb.get().coerceIn(-1f, 1f) * 32767).toInt(); conv[k * 2] = v.toByte(); conv[k * 2 + 1] = (v shr 8).toByte() }
                                os.write(conv, 0, n * 2); written += n * 2
                            } else {
                                val n = info.size; if (conv.size < n) conv = ByteArray(n)
                                buf.get(conv, 0, n); os.write(conv, 0, n); written += n
                            }
                            c.releaseOutputBuffer(o, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outDone = true
                            if (written > MAX_BYTES) throw IOException("file too long to convert")
                        }
                    }
                }
            }
            if (written == 0L) throw IOException("the decoder produced no sound")
            RandomAccessFile(tmp, "rw").use { it.seek(0); it.write(header(written, rate, channels)) }
            if (!tmp.renameTo(out)) throw IOException("could not save the converted copy")
            return out
        } finally {
            try { codec?.stop() } catch (_: Throwable) {}
            try { codec?.release() } catch (_: Throwable) {}
            ex.release()
            tmp.delete()
        }
    }

    fun header(dataBytes: Long, rate: Int, channels: Int): ByteArray {
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt((36 + dataBytes).toInt()); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(1); b.putShort(channels.toShort()); b.putInt(rate)
        b.putInt(rate * channels * 2); b.putShort((channels * 2).toShort()); b.putShort(16)
        b.put("data".toByteArray()); b.putInt(dataBytes.toInt())
        return b.array()
    }

    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
