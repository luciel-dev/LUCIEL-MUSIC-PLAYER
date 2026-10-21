package com.luciel.player

import org.json.JSONObject
import kotlin.math.roundToInt

/** small pure helpers for the genre-pack features (unit-tested in WeatherPlaceTest) */
object WeatherPlace {
    /** round to 0.1° (≈ 11 km): the weather layer never needs, and never receives, a precise position */
    fun round(v: Double): Double = (v * 10).roundToInt() / 10.0
    fun json(lat: Double, lon: Double): String = JSONObject().put("ok", true).put("lat", round(lat)).put("lon", round(lon)).toString()
    /** an opened / shared file that is a visual pack (.zip) rather than audio */
    fun isPackZip(mime: String?, name: String?): Boolean {
        val m = (mime ?: "").lowercase()
        if (m.startsWith("audio/")) return false
        return m == "application/zip" || m == "application/x-zip-compressed" || m == "application/x-zip" || (name ?: "").lowercase().endsWith(".zip")
    }
}
