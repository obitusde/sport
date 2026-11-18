/*
 * Update.kt – Prüft auf GitHub, ob es eine neuere APK gibt
 * Version: 0.7.0 (2026-11-18)
 *
 * Die GitHub Action veröffentlicht jede APK als Release mit dem Tag „apk-<Laufnummer>“.
 * Die Laufnummer ist zugleich der versionCode. Ist sie höher als die installierte,
 * erscheint eine Benachrichtigung; Tippen lädt die APK im Browser herunter.
 */
package de.obitus.sport

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject

object Update {
    private const val API = "https://api.github.com/repos/obitusde/sport/releases/latest"

    data class Info(val code: Int, val name: String, val url: String)

    fun suchen(): Info? {
        val j = JSONObject(Netz.holen(API, "application/vnd.github+json"))
        val code = j.optString("tag_name").removePrefix("apk-").toIntOrNull() ?: return null
        val assets = j.optJSONArray("assets") ?: return null
        if (assets.length() == 0) return null
        val url = assets.getJSONObject(0).optString("browser_download_url")
        if (url.isBlank()) return null
        return Info(code, j.optString("name", "apk-$code"), url)
    }

    /** Prüft und meldet ein Update per Benachrichtigung. Liefert einen Text für die Oberfläche. */
    fun pruefen(c: Context): String {
        val info = suchen() ?: return "Keine veröffentlichte Version gefunden."
        if (info.code <= BuildConfig.VERSION_CODE) return "Die App ist aktuell (Version ${BuildConfig.VERSION_NAME})."
        val laden = PendingIntent.getActivity(
            c, 1,
            Intent(Intent.ACTION_VIEW, Uri.parse(info.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        Melder.zeigen(c, Melder.KANAL_UPDATES, Melder.ID_UPDATE, "Update verfügbar",
            "${info.name}. Tippen zum Herunterladen, dann die Datei öffnen und installieren.", laden)
        return "Update verfügbar: ${info.name}. Siehe Benachrichtigung."
    }
}
