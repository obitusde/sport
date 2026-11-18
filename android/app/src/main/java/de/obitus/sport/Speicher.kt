/*
 * Speicher.kt – Einstellungen der Android-App
 * Version: 0.7.0 (2026-11-18)
 *
 * Speichert lokal auf dem Gerät (privat, nur diese App):
 * - Web-App-URL und Token (kommen aus der Web-Oberfläche über die Brücke),
 * - die Einstellungen der Benachrichtigungen,
 * - Zeitpunkte, wann zuletzt geprüft bzw. benachrichtigt wurde.
 */
package de.obitus.sport

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

object Speicher {
    private const val NAME = "sport"

    /** Standard: Erinnerung Do 18 Uhr, Rückblick So 19 Uhr, Erfolge an. Tag 1 = Montag … 7 = Sonntag. */
    private const val STANDARD_BENACHRICHTIGUNGEN =
        """{"erinnerung":{"an":true,"tag":4,"stunde":18},"rueckblick":{"an":true,"tag":7,"stunde":19},"erfolge":{"an":true}}"""

    fun prefs(c: Context): SharedPreferences = c.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun url(c: Context): String = prefs(c).getString("url", "") ?: ""
    fun token(c: Context): String = prefs(c).getString("token", "") ?: ""
    fun hatVerbindung(c: Context): Boolean = url(c).isNotBlank() && token(c).isNotBlank()

    fun verbindungSetzen(c: Context, url: String, token: String) {
        prefs(c).edit().putString("url", url.trim()).putString("token", token.trim()).apply()
    }

    fun benachrichtigungen(c: Context): JSONObject {
        val standard = JSONObject(STANDARD_BENACHRICHTIGUNGEN)
        val text = prefs(c).getString("benachrichtigungen", null) ?: return standard
        return try {
            val gespeichert = JSONObject(text)
            // Fehlende Teile mit Standard auffüllen
            standard.keys().forEach { k -> if (!gespeichert.has(k)) gespeichert.put(k, standard.get(k)) }
            gespeichert
        } catch (e: Exception) {
            standard
        }
    }

    /** Prüft und speichert die Einstellungen; ungültige Werte werden korrigiert. */
    fun benachrichtigungenSetzen(c: Context, json: String) {
        val neu = JSONObject(json)
        val sauber = JSONObject()
        listOf("erinnerung", "rueckblick").forEach { art ->
            val e = neu.optJSONObject(art) ?: JSONObject()
            sauber.put(art, JSONObject()
                .put("an", e.optBoolean("an", true))
                .put("tag", e.optInt("tag", if (art == "erinnerung") 4 else 7).coerceIn(1, 7))
                .put("stunde", e.optInt("stunde", if (art == "erinnerung") 18 else 19).coerceIn(0, 23)))
        }
        sauber.put("erfolge", JSONObject().put("an", neu.optJSONObject("erfolge")?.optBoolean("an", true) ?: true))
        prefs(c).edit().putString("benachrichtigungen", sauber.toString()).apply()
    }
}
