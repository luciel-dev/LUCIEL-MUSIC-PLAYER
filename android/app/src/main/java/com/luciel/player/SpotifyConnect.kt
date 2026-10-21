package com.luciel.player

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Optional "Connect Spotify": lets Luciel load your playlists, Liked Songs, recently played and search results
 * in-app through the Spotify Web API.
 *
 * - Authorization Code + PKCE (RFC 7636), no client secret anywhere. The Client ID is the user's own (Settings >
 *   Spotify), nothing is built in.
 * - Redirect luciel://spotify-callback (opened in a Custom Tab, caught by [SpotifyCallbackActivity]).
 * - Tokens stay native, in EncryptedSharedPreferences; the page only ever sees API results, never a token.
 * - Network: accounts.spotify.com and api.spotify.com only (covers go through [ImageProxy]).
 */
object Pkce {
    private const val CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    fun verifier(rnd: SecureRandom = SecureRandom(), len: Int = 64): String {
        require(len in 43..128)
        return buildString { repeat(len) { append(CHARS[rnd.nextInt(CHARS.length)]) } }
    }
    fun challenge(verifier: String): String = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
    fun state(rnd: SecureRandom = SecureRandom()): String = b64url(ByteArray(16).also { rnd.nextBytes(it) })
    fun b64url(b: ByteArray): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b)
}

/** tiny key-value store (EncryptedSharedPreferences on the phone, a map in tests) */
interface Kv { fun get(k: String): String?; fun put(k: String, v: String?) }

class HttpResp(val code: Int, val body: String, val headers: Map<String, String> = emptyMap())
fun interface Http { fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResp }

class SpotifyClient(private val kv: Kv, private val http: Http, private val now: () -> Long = System::currentTimeMillis) {
    companion object {
        const val REDIRECT = "luciel://spotify-callback"
        const val AUTH = "https://accounts.spotify.com/authorize"
        const val TOKEN = "https://accounts.spotify.com/api/token"
        const val API = "https://api.spotify.com/v1"
        val SCOPES = listOf("playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-read-recently-played",
            "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing")
        private val ID = Regex("^[0-9a-f]{32}$")
        private val PATH = Regex("^/(me|search|playlists|albums|artists|tracks|shows|episodes|audiobooks)([/?].*)?$")
        fun validClientId(id: String) = ID.matches(id.trim().lowercase())
        fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
        fun form(m: Map<String, String>) = m.entries.joinToString("&") { enc(it.key) + "=" + enc(it.value) }
    }

    var clientId: String
        get() = kv.get("client_id") ?: ""
        set(v) { val t = v.trim().lowercase(); if (t != clientId) { disconnect(); kv.put("client_id", t.ifEmpty { null }) } }
    val connected get() = !kv.get("refresh").isNullOrEmpty() || (!kv.get("access").isNullOrEmpty() && expiresAt() > now())
    private fun expiresAt() = kv.get("expires")?.toLongOrNull() ?: 0L

    fun authorizeUrl(clientId: String, challenge: String, state: String): String = AUTH + "?" + form(linkedMapOf(
        "client_id" to clientId, "response_type" to "code", "redirect_uri" to REDIRECT, "code_challenge_method" to "S256",
        "code_challenge" to challenge, "state" to state, "scope" to SCOPES.joinToString(" ")))

    /** starts a sign-in: remembers the verifier + state, returns the URL to open (null without a valid Client ID) */
    fun begin(rnd: SecureRandom = SecureRandom()): String? {
        val id = clientId; if (!validClientId(id)) return null
        val v = Pkce.verifier(rnd); val st = Pkce.state(rnd)
        kv.put("pkce_verifier", v); kv.put("pkce_state", st); kv.put("pkce_at", now().toString())
        return authorizeUrl(id, Pkce.challenge(v), st)
    }

    /** handles luciel://spotify-callback?code=…&state=…  -> "ok" or a short error ("denied", "state", "exchange: …") */
    fun finish(params: Map<String, String?>): String {
        val v = kv.get("pkce_verifier"); val st = kv.get("pkce_state")
        kv.put("pkce_verifier", null); kv.put("pkce_state", null)
        params["error"]?.let { return if (it == "access_denied") "denied" else "error: $it" }
        if (v == null || st == null || params["state"] != st) return "state"
        val code = params["code"] ?: return "error: no code"
        val r = http.send("POST", TOKEN, mapOf("Content-Type" to "application/x-www-form-urlencoded"),
            form(linkedMapOf("grant_type" to "authorization_code", "code" to code, "redirect_uri" to REDIRECT, "client_id" to clientId, "code_verifier" to v)))
        return if (r.code == 200 && saveTokens(r.body)) "ok" else "exchange: " + errorOf(r)
    }

    private fun saveTokens(body: String): Boolean = try {
        val j = JSONObject(body)
        val at = j.getString("access_token")
        kv.put("access", at); kv.put("expires", (now() + j.optLong("expires_in", 3600) * 1000).toString())
        j.optString("refresh_token").takeIf { it.isNotEmpty() }?.let { kv.put("refresh", it) }   // refresh may omit it: keep the old one
        j.optString("scope").takeIf { it.isNotEmpty() }?.let { kv.put("scope", it) }
        true
    } catch (_: Exception) { false }

    private fun errorOf(r: HttpResp): String = try { JSONObject(r.body).let { j -> j.optString("error_description").ifEmpty { j.opt("error")?.let { e -> if (e is JSONObject) e.optString("message") else e.toString() } ?: "" } } }
        catch (_: Exception) { "" }.ifEmpty { "HTTP ${r.code}" }

    /** a valid access token, refreshing when it is about to expire (null = not connected / refresh refused) */
    @Synchronized fun token(force: Boolean = false): String? {
        val at = kv.get("access")
        if (!force && !at.isNullOrEmpty() && expiresAt() - 60_000 > now()) return at
        val rt = kv.get("refresh") ?: return null
        val r = http.send("POST", TOKEN, mapOf("Content-Type" to "application/x-www-form-urlencoded"),
            form(linkedMapOf("grant_type" to "refresh_token", "refresh_token" to rt, "client_id" to clientId)))
        if (r.code == 200 && saveTokens(r.body)) return kv.get("access")
        if (r.code == 400 || r.code == 401) disconnect()           // revoked / invalid_grant: back to "not connected"
        return null
    }

    /** one Web API call; path like "/me/playlists?limit=20". 401 -> refresh once and retry. */
    fun api(method: String, path: String, body: String?): HttpResp {
        val m = method.uppercase()
        if (m !in setOf("GET", "PUT", "POST", "DELETE")) return HttpResp(400, """{"error":{"status":400,"message":"method"}}""")
        if (!PATH.matches(path)) return HttpResp(400, """{"error":{"status":400,"message":"path"}}""")
        var t = token() ?: return HttpResp(401, """{"error":{"status":401,"message":"not connected"}}""")
        val h = { tok: String -> mapOf("Authorization" to "Bearer $tok") + (if (body != null) mapOf("Content-Type" to "application/json") else emptyMap()) }
        var r = http.send(m, API + path, h(t), body)
        if (r.code == 401) { t = token(force = true) ?: return r; r = http.send(m, API + path, h(t), body) }
        return r
    }

    fun disconnect() { listOf("access", "refresh", "expires", "scope", "pkce_verifier", "pkce_state").forEach { kv.put(it, null) } }

    /** scopes this version needs that the saved sign-in doesn't have (an older sign-in -> one-tap reconnect) */
    fun missingScopes(): List<String> {
        val g = kv.get("scope")?.split(' ')?.filter { it.isNotBlank() }?.toSet() ?: return emptyList()   // unknown: assume fine
        if (g.isEmpty()) return emptyList()
        return SCOPES.filter { it !in g }
    }
    fun status(): JSONObject = JSONObject().put("clientId", clientId).put("validId", validClientId(clientId)).put("connected", connected)
        .put("redirect", REDIRECT).put("scope", kv.get("scope") ?: "").put("missing", org.json.JSONArray(if (connected) missingScopes() else emptyList()))
}

/** the real network: https to Spotify's account + API hosts only */
object SpotifyHttp : Http {
    private val HOSTS = setOf("accounts.spotify.com", "api.spotify.com")
    override fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResp {
        val u = URL(url)
        if (u.protocol != "https" || u.host !in HOSTS) return HttpResp(400, "")
        return try {
            val c = u.openConnection() as HttpURLConnection
            c.requestMethod = method; c.connectTimeout = 10000; c.readTimeout = 15000; c.instanceFollowRedirects = false
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
            else if (method == "PUT" || method == "POST") { c.doOutput = true; c.setFixedLengthStreamingMode(0) }
            val code = c.responseCode
            val txt = (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            val hs = mutableMapOf<String, String>(); c.getHeaderField("Retry-After")?.let { hs["retry-after"] = it }
            c.disconnect(); HttpResp(code, txt, hs)
        } catch (e: Exception) { HttpResp(0, """{"error":{"status":0,"message":${JSONObject.quote(e.javaClass.simpleName)}}}""") }
    }
}

/** EncryptedSharedPreferences-backed store (AES-256 GCM values / SIV keys, key in the Android Keystore) */
class EncryptedKv(ctx: Context) : Kv {
    @Suppress("DEPRECATION")
    private val p = try {
        val key = androidx.security.crypto.MasterKey.Builder(ctx).setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM).build()
        androidx.security.crypto.EncryptedSharedPreferences.create(ctx, "spotify_auth", key,
            androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    } catch (e: Exception) {
        // a corrupted keyset (e.g. after a restore): start clean rather than crash; the user just connects again
        DebugLog.add("spotify", "secure store reset: ${e.javaClass.simpleName}")
        ctx.deleteSharedPreferences("spotify_auth")
        val key = androidx.security.crypto.MasterKey.Builder(ctx).setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM).build()
        androidx.security.crypto.EncryptedSharedPreferences.create(ctx, "spotify_auth", key,
            androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }
    override fun get(k: String): String? = p.getString(k, null)
    override fun put(k: String, v: String?) { p.edit().apply { if (v == null) remove(k) else putString(k, v) }.apply() }
}

object SpotifyConnect {
    @Volatile private var inst: SpotifyClient? = null
    fun get(ctx: Context): SpotifyClient = inst ?: synchronized(this) { inst ?: SpotifyClient(EncryptedKv(ctx.applicationContext), SpotifyHttp).also { inst = it } }

    /** opens Spotify's sign-in page in a Custom Tab */
    fun launch(ctx: Context, url: String) {
        try {
            androidx.browser.customtabs.CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, Uri.parse(url))
        } catch (_: Exception) {
            ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /** result of a sign-in, pushed to the page */
    fun notifyPage(result: String, status: JSONObject) {
        WebBridge.pushEvent("spotifyAuth", JSONObject().put("result", result).put("status", status))
    }
}
