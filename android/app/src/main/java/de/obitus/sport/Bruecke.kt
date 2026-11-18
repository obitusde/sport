/*
 * Bruecke.kt – Schnittstelle zwischen Web-Oberfläche und Android („window.SportApp“)
 * Version: 0.7.0 (2026-11-18)
 *
 * Nur für die eigene Seite obitusde.github.io gedacht (MainActivity lädt nichts anderes).
 * Alle Methoden laufen auf einem Hintergrund-Thread des WebViews; Netzwerk-Aufrufe
 * starten einen eigenen Thread und melden das Ergebnis über window.nativeMeldung.
 */
package de.obitus.sport

import android.webkit.JavascriptInterface
import org.json.JSONObject

class Bruecke(private val a: MainActivity) {

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun verbindungSetzen(url: String, token: String) = Speicher.verbindungSetzen(a, url, token)

    @JavascriptInterface
    fun benachrichtigungenLesen(): String = Speicher.benachrichtigungen(a).toString()

    @JavascriptInterface
    fun benachrichtigungenSetzen(json: String): Boolean = try {
        Speicher.benachrichtigungenSetzen(a, json)
        true
    } catch (e: Exception) {
        false
    }

    @JavascriptInterface
    fun benachrichtigungenErlaubt(): Boolean = Melder.erlaubt(a)

    @JavascriptInterface
    fun benachrichtigungenAnfragen() = a.runOnUiThread { a.benachrichtigungenErlauben() }

    /** Diagnose: holt eine Test-Meldung von der Web-App und zeigt sie als Benachrichtigung. */
    @JavascriptInterface
    fun testBenachrichtigung() {
        Thread {
            val text = try {
                if (!Melder.erlaubt(a)) {
                    "Benachrichtigungen sind nicht erlaubt."
                } else {
                    val m = Pruefung.meldung(a, "test")
                    if (m == null) "Die Web-App hat keine Test-Meldung geliefert."
                    else {
                        Melder.zeigen(a, Melder.KANAL_ZIELE, Melder.ID_TEST, m.first, m.second)
                        "Test-Benachrichtigung verschickt."
                    }
                }
            } catch (e: Exception) {
                "Test fehlgeschlagen: ${e.message}"
            }
            a.meldungAnWeb(text)
        }.start()
    }

    /** Zeigt die aktuelle Erinnerung bzw. den Rückblick sofort (zum Ausprobieren). */
    @JavascriptInterface
    fun vorschau(art: String) {
        Thread {
            val text = try {
                val m = Pruefung.meldung(a, art, if (art == "erfolge") mapOf("seit" to "1") else emptyMap())
                if (m == null) "Im Moment gibt es dazu nichts zu melden."
                else {
                    Melder.zeigen(a, Melder.KANAL_ZIELE, Melder.ID_TEST, m.first, m.second)
                    "Vorschau als Benachrichtigung verschickt."
                }
            } catch (e: Exception) {
                "Vorschau fehlgeschlagen: ${e.message}"
            }
            a.meldungAnWeb(text)
        }.start()
    }

    @JavascriptInterface
    fun updatePruefen() {
        Thread {
            val text = try { Update.pruefen(a) } catch (e: Exception) { "Update-Prüfung fehlgeschlagen: ${e.message}" }
            a.meldungAnWeb(text)
        }.start()
    }

    @JavascriptInterface
    fun status(): String = JSONObject()
        .put("version", BuildConfig.VERSION_NAME)
        .put("verbindung", Speicher.hatVerbindung(a))
        .put("benachrichtigungenErlaubt", Melder.erlaubt(a))
        .toString()
}
