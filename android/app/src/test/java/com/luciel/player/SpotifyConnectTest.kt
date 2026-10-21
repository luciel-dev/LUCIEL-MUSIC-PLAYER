package com.luciel.player

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.URI
import java.net.URLDecoder
import java.security.SecureRandom

/** PKCE + the sign-in / token / API flow against a mocked Spotify (no network) */
class SpotifyConnectTest {
    private class MapKv : Kv { val m = HashMap<String, String>(); override fun get(k: String) = m[k]; override fun put(k: String, v: String?) { if (v == null) m.remove(k) else m[k] = v } }
    private class Call(val method: String, val url: String, val headers: Map<String, String>, val body: String?)
    private class FakeSpotify : Http {
        val calls = mutableListOf<Call>(); var next = ArrayDeque<HttpResp>()
        override fun send(method: String, url: String, headers: Map<String, String>, body: String?): HttpResp { calls += Call(method, url, headers, body); return next.removeFirstOrNull() ?: HttpResp(500, "") }
    }
    private fun q(s: String) = s.split("&").associate { it.substringBefore("=") to URLDecoder.decode(it.substringAfter("="), "UTF-8") }
    private val ID = "0123456789abcdef0123456789abcdef"

    @Test fun pkceRfc7636Vector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }
    @Test fun pkceVerifierShape() {
        val seen = HashSet<String>()
        repeat(50) {
            val v = Pkce.verifier()
            assertEquals(64, v.length); assertTrue(v.matches(Regex("^[A-Za-z0-9._~-]+$"))); assertTrue(seen.add(v))
            val c = Pkce.challenge(v); assertEquals(43, c.length); assertFalse(c.contains('=') || c.contains('+') || c.contains('/'))
        }
        assertThrows(IllegalArgumentException::class.java) { Pkce.verifier(SecureRandom(), 42) }
    }
    @Test fun clientIdIsUsersOwnAndValidated() {
        val c = SpotifyClient(MapKv(), FakeSpotify())
        assertEquals("", c.clientId); assertNull(c.begin())            // nothing built in
        assertFalse(SpotifyClient.validClientId("abc")); assertFalse(SpotifyClient.validClientId("g123456789abcdef0123456789abcdef"))
        assertTrue(SpotifyClient.validClientId(" 0123456789ABCDEF0123456789abcdef "))
    }
    @Test fun authorizeUrlHasPkceAndRedirect() {
        val kv = MapKv(); val c = SpotifyClient(kv, FakeSpotify()); c.clientId = ID
        val u = URI(c.begin()!!); val p = q(u.rawQuery)
        assertEquals("accounts.spotify.com", u.host); assertEquals("/authorize", u.path)
        assertEquals(ID, p["client_id"]); assertEquals("code", p["response_type"]); assertEquals("luciel://spotify-callback", p["redirect_uri"])
        assertEquals("S256", p["code_challenge_method"]); assertEquals(Pkce.challenge(kv.get("pkce_verifier")!!), p["code_challenge"])
        assertEquals(kv.get("pkce_state"), p["state"]); assertTrue(p["scope"]!!.split(" ").containsAll(listOf("playlist-read-private", "user-library-read", "user-read-recently-played", "user-modify-playback-state")))
        assertFalse(u.toString().contains("secret"))
    }
    @Test fun exchangeRefreshAndApi() {
        var t = 1_000_000L
        val kv = MapKv(); val net = FakeSpotify(); val c = SpotifyClient(kv, net) { t }; c.clientId = ID
        c.begin(); val verifier = kv.get("pkce_verifier")!!; val state = kv.get("pkce_state")!!
        assertEquals("state", SpotifyClient(kv, net).finish(mapOf("code" to "C", "state" to "forged")))   // state mismatch rejected (and the verifier is spent)
        c.begin(); val v2 = kv.get("pkce_verifier")!!; val st2 = kv.get("pkce_state")!!; assertNotEquals(verifier, v2); assertNotEquals(state, st2)
        net.next += HttpResp(200, """{"access_token":"A1","token_type":"Bearer","expires_in":3600,"refresh_token":"R1","scope":"playlist-read-private"}""")
        assertEquals("ok", c.finish(mapOf("code" to "C", "state" to st2)))
        val ex = net.calls.last(); assertEquals("https://accounts.spotify.com/api/token", ex.url); val f = q(ex.body!!)
        assertEquals("authorization_code", f["grant_type"]); assertEquals(v2, f["code_verifier"]); assertEquals(ID, f["client_id"]); assertNull(f["client_secret"])
        assertTrue(c.connected)
        net.next += HttpResp(200, """{"items":[]}""")
        assertEquals(200, c.api("GET", "/me/playlists?limit=20", null).code)
        assertEquals("Bearer A1", net.calls.last().headers["Authorization"]); assertEquals("https://api.spotify.com/v1/me/playlists?limit=20", net.calls.last().url)
        // expiring -> refresh first (Spotify may omit a new refresh token: keep the old one)
        t += 3_590_000L
        net.next += HttpResp(200, """{"access_token":"A2","expires_in":3600}"""); net.next += HttpResp(200, "{}")
        c.api("GET", "/me/tracks", null)
        assertEquals("refresh_token", q(net.calls[net.calls.size - 2].body!!)["grant_type"]); assertEquals("Bearer A2", net.calls.last().headers["Authorization"]); assertEquals("R1", kv.get("refresh"))
        // 401 -> refresh once and retry
        net.next += HttpResp(401, "{}"); net.next += HttpResp(200, """{"access_token":"A3","expires_in":3600}"""); net.next += HttpResp(204, "")
        assertEquals(204, c.api("PUT", "/me/player/play", """{"context_uri":"spotify:playlist:x"}""").code)
        assertEquals("Bearer A3", net.calls.last().headers["Authorization"])
        // only Web API paths
        assertEquals(400, c.api("GET", "/../evil", null).code); assertEquals(400, c.api("GET", "https://evil.example/", null).code)
        // revoked refresh -> disconnected
        t += 7_200_000L; net.next += HttpResp(400, """{"error":"invalid_grant"}""")
        assertEquals(401, c.api("GET", "/me/tracks", null).code); assertFalse(c.connected)
    }
    @Test fun deniedAndChangedClientId() {
        val kv = MapKv(); val c = SpotifyClient(kv, FakeSpotify()); c.clientId = ID; c.begin()
        assertEquals("denied", c.finish(mapOf("error" to "access_denied", "state" to kv.get("pkce_state"))))
        kv.put("refresh", "R"); assertTrue(c.connected)
        c.clientId = "ffffffffffffffffffffffffffffffff"; assertFalse(c.connected)   // another app -> sign in again
        val st = JSONObject(c.status().toString()); assertEquals("luciel://spotify-callback", st.getString("redirect")); assertFalse(st.getBoolean("connected"))
    }
}
