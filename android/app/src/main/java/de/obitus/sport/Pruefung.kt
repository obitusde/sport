/*
 * Pruefung.kt – Was der Hintergrund-Job bei jedem Lauf prüft
 * Version: 0.8.0 (2026-11-18)
 *
 * Der Job läuft etwa alle 30 Minuten (Android kann ihn verzögern). Bei jedem Lauf:
 * - Erinnerung / Wochenrückblick: Ist der eingestellte Zeitpunkt dieser Woche erreicht
 *   (höchstens 6 Stunden her) und noch nicht gemeldet, holt die App den Text von der
 *   Web-App (Aktion „meldung“) und zeigt ihn an. Die Web-App liefert keinen Text,
 *   wenn es nichts zu melden gibt (z. B. beide Ziele schon erreicht).
 * - Erfolge: höchstens alle 3 Stunden; die Web-App meldet Bestzeiten, Bestmarken und
 *   Jahres-Abzeichen von Aktivitäten, die seit der letzten Prüfung importiert wurden.
 * - Update: höchstens einmal pro Tag.
 * - Schritte (ab 0.8.0): Zähler lesen und verbuchen, höchstens alle 2 Stunden an die
 *   Web-App übertragen.
 * Die Texte rechnet die Web-App, damit die Logik nur an einer Stelle steht.
 */
package de.obitus.sport

import android.content.Context
import android.util.Log
import java.time.DayOfWeek
import java.time.Duration
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

object Pruefung {
    private const val TAG = "SportPruefung"
    private val ZONE: ZoneId = ZoneId.of("Europe/Zurich")
    private const val STUNDE = 3_600_000L

    fun laufen(c: Context) {
        val p = Speicher.prefs(c)
        val jetzt = ZonedDateTime.now(ZONE)
        val jetztMs = System.currentTimeMillis()

        if (Schritte.erlaubt(c)) {
            try {
                Schritte.aktualisieren(c)
                if (Speicher.hatVerbindung(c) && jetztMs - p.getLong("schritte_gesendet", 0) > 2 * STUNDE) Schritte.senden(c)
            } catch (ex: Exception) {
                Log.w(TAG, "Schritte fehlgeschlagen: ${ex.message}")
            }
        }

        if (Speicher.hatVerbindung(c)) {
            val k = Speicher.benachrichtigungen(c)
            listOf("erinnerung" to Melder.ID_ERINNERUNG, "rueckblick" to Melder.ID_RUECKBLICK).forEach { (art, id) ->
                val e = k.optJSONObject(art) ?: return@forEach
                if (!e.optBoolean("an")) return@forEach
                val termin = jetzt.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                    .plusDays((e.optInt("tag", 1) - 1).toLong())
                    .withHour(e.optInt("stunde", 18)).truncatedTo(ChronoUnit.HOURS)
                val faellig = !jetzt.isBefore(termin) && Duration.between(termin, jetzt).toHours() < 6
                val schonGemeldet = p.getLong("gemeldet_$art", 0) >= termin.toInstant().toEpochMilli()
                if (faellig && !schonGemeldet) {
                    try {
                        meldung(c, art)?.let { (titel, text) -> Melder.zeigen(c, Melder.KANAL_ZIELE, id, titel, text) }
                        p.edit().putLong("gemeldet_$art", jetztMs).apply()
                    } catch (ex: Exception) {
                        Log.w(TAG, "$art fehlgeschlagen: ${ex.message}")
                    }
                }
            }

            if (k.optJSONObject("erfolge")?.optBoolean("an") == true) {
                val seit = p.getLong("erfolge_seit", 0)
                if (seit == 0L) {
                    // Erster Lauf: nur Startpunkt merken, keine alten Erfolge melden
                    p.edit().putLong("erfolge_seit", jetztMs).apply()
                } else if (jetztMs - p.getLong("erfolge_geprueft", 0) > 3 * STUNDE) {
                    try {
                        meldung(c, "erfolge", mapOf("seit" to seit.toString()))?.let { (titel, text) ->
                            Melder.zeigen(c, Melder.KANAL_ERFOLGE, Melder.ID_ERFOLGE, titel, text)
                        }
                        p.edit().putLong("erfolge_seit", jetztMs).putLong("erfolge_geprueft", jetztMs).apply()
                    } catch (ex: Exception) {
                        Log.w(TAG, "Erfolge fehlgeschlagen: ${ex.message}")
                    }
                }
            }
        }

        if (jetztMs - p.getLong("update_geprueft", 0) > 20 * STUNDE) {
            try {
                Update.pruefen(c)
                p.edit().putLong("update_geprueft", jetztMs).apply()
            } catch (ex: Exception) {
                Log.w(TAG, "Update-Prüfung fehlgeschlagen: ${ex.message}")
            }
        }
    }

    /** Holt Titel und Text einer Meldung von der Web-App, oder null, wenn es nichts zu melden gibt. */
    fun meldung(c: Context, art: String, extra: Map<String, String> = emptyMap()): Pair<String, String>? {
        val j = Netz.webApp(c, "meldung", mapOf("art" to art) + extra)
        val m = j.optJSONObject("meldung") ?: return null
        return m.optString("titel") to m.optString("text")
    }
}
