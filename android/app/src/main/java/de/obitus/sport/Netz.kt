/*
 * Netz.kt – Abrufe der Web-App (Apps Script) und von GitHub
 * Version: 0.7.0 (2026-11-18)
 *
 * Nur im Hintergrund-Thread aufrufen. Das Token wird nie geloggt.
 */
package de.obitus.sport

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

object Netz {

    fun holen(adresse: String, accept: String = "application/json"): String {
        val v = URL(adresse).openConnection() as HttpURLConnection
        try {
            v.connectTimeout = 15_000
            v.readTimeout = 60_000
            v.instanceFollowRedirects = true // Apps Script leitet auf googleusercontent.com um
            v.setRequestProperty("Accept", accept)
            v.setRequestProperty("User-Agent", "Sport-App/" + BuildConfig.VERSION_NAME)
            val code = v.responseCode
            val strom = if (code in 200..299) v.inputStream else v.errorStream
            val text = strom?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) throw IOException("HTTP $code")
            return text
        } finally {
            v.disconnect()
        }
    }

    /** Ruft eine Aktion der Web-App auf und liefert die JSON-Antwort (ok = true). */
    fun webApp(c: Context, aktion: String, parameter: Map<String, String> = emptyMap()): JSONObject {
        if (!Speicher.hatVerbindung(c)) throw IOException("Keine Verbindung eingetragen.")
        val b = Uri.parse(Speicher.url(c)).buildUpon()
            .appendQueryParameter("token", Speicher.token(c))
            .appendQueryParameter("aktion", aktion)
        parameter.forEach { (k, w) -> b.appendQueryParameter(k, w) }
        val j = JSONObject(holen(b.build().toString()))
        if (!j.optBoolean("ok")) {
            val f = j.optString("fehler", "unbekannter Fehler")
            throw IOException(if (f == "nicht berechtigt") "Token falsch." else f)
        }
        return j
    }
}
