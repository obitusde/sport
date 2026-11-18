/*
 * Schritte.kt – Schrittzähler des Handys
 * Version: 0.8.0 (2026-11-18)
 *
 * Liest den Hardware-Schrittzähler (Sensor.TYPE_STEP_COUNTER). Er zählt seit dem letzten
 * Neustart des Handys ständig mit und braucht praktisch keinen Akku. Die App liest ihn
 * etwa alle 30 Minuten (Hintergrund-Job) und beim Öffnen, rechnet die Differenz zum
 * letzten Stand und verteilt sie auf die Kalendertage (Europe/Zurich):
 * - gleicher Tag: alles auf diesen Tag,
 * - über Mitternacht (Folgetag): anteilig nach Zeit,
 * - längere Lücke (Handy aus o. Ä.): alles auf den aktuellen Tag.
 * Nach einem Neustart beginnt der Zähler bei 0; dann zählt der neue Stand ganz.
 * Gespeichert werden die letzten 120 Tage im privaten App-Speicher; übertragen werden
 * die letzten 14 Tage an die Web-App (Aktion „schritteSetzen“).
 * Gezählt wird erst ab dem ersten Lesen nach der Installation.
 */
package de.obitus.sport

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object Schritte {
    private val ZONE: ZoneId = ZoneId.of("Europe/Zurich")
    private const val TAGE_BEHALTEN = 120L
    private const val TAGE_SENDEN = 14L
    private const val MAX_PRO_LESEN = 80_000f // mehr ist kein Gehen, sondern ein Fehler

    fun erlaubt(c: Context): Boolean =
        c.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

    fun sensorVorhanden(c: Context): Boolean =
        c.getSystemService(SensorManager::class.java).getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null

    /** Liest den aktuellen Zählerstand (blockiert bis 10 s). Nicht auf dem UI-Thread aufrufen. */
    fun zaehlerLesen(c: Context): Float? {
        if (!erlaubt(c)) return null
        val sm = c.getSystemService(SensorManager::class.java)
        val sensor = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
        val fertig = CountDownLatch(1)
        var wert: Float? = null
        val faden = HandlerThread("schritte").apply { start() }
        val hoerer = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                wert = e.values[0]
                fertig.countDown()
            }
            override fun onAccuracyChanged(s: Sensor?, genauigkeit: Int) {}
        }
        try {
            sm.registerListener(hoerer, sensor, SensorManager.SENSOR_DELAY_NORMAL, Handler(faden.looper))
            fertig.await(10, TimeUnit.SECONDS)
        } finally {
            sm.unregisterListener(hoerer)
            faden.quitSafely()
        }
        return wert
    }

    /** Gespeicherte Tageswerte: {"2026-11-18": 5234, …} */
    fun tage(c: Context): JSONObject = try {
        JSONObject(Speicher.prefs(c).getString("schritte_tage", "{}") ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    fun heute(c: Context): Long = tage(c).optLong(LocalDate.now(ZONE).toString(), 0)

    /** Liest den Zähler und verbucht die neuen Schritte. Liefert den Zählerstand oder null. */
    @Synchronized
    fun aktualisieren(c: Context): Float? {
        val roh = zaehlerLesen(c) ?: return null
        val p = Speicher.prefs(c)
        val jetzt = System.currentTimeMillis()
        val tage = tage(c)
        if (p.contains("schritte_letzt_wert")) {
            val letztWert = p.getFloat("schritte_letzt_wert", roh)
            val letztZeit = p.getLong("schritte_letzt_zeit", jetzt)
            var neu = roh - letztWert
            if (neu < 0) neu = roh // Neustart des Handys: Zähler begann wieder bei 0
            if (neu in 1f..MAX_PRO_LESEN) verbuchen(tage, neu.toLong(), letztZeit, jetzt)
        }
        // Alte Tage entfernen
        val grenze = LocalDate.now(ZONE).minusDays(TAGE_BEHALTEN).toString()
        tage.keys().asSequence().toList().filter { it < grenze }.forEach { tage.remove(it) }
        p.edit()
            .putFloat("schritte_letzt_wert", roh)
            .putLong("schritte_letzt_zeit", jetzt)
            .putString("schritte_tage", tage.toString())
            .apply()
        return roh
    }

    private fun verbuchen(tage: JSONObject, anzahl: Long, von: Long, bis: Long) {
        val tagVon = Instant.ofEpochMilli(von).atZone(ZONE).toLocalDate()
        val tagBis = Instant.ofEpochMilli(bis).atZone(ZONE).toLocalDate()
        fun dazu(tag: LocalDate, n: Long) {
            if (n <= 0) return
            val k = tag.toString()
            tage.put(k, tage.optLong(k, 0) + n)
        }
        if (tagVon == tagBis || bis <= von) {
            dazu(tagBis, anzahl)
        } else if (tagBis == tagVon.plusDays(1)) {
            val mitternacht = tagBis.atStartOfDay(ZONE).toInstant().toEpochMilli()
            val anteil = (mitternacht - von).toDouble() / (bis - von).toDouble()
            val vorher = Math.round(anzahl * anteil)
            dazu(tagVon, vorher)
            dazu(tagBis, anzahl - vorher)
        } else {
            dazu(tagBis, anzahl)
        }
    }

    /** Die letzten 14 Tage als JSON für die Web-App. */
    fun zumSenden(c: Context): JSONObject {
        val alle = tage(c)
        val grenze = LocalDate.now(ZONE).minusDays(TAGE_SENDEN).toString()
        val auswahl = JSONObject()
        alle.keys().forEach { k -> if (k >= grenze) auswahl.put(k, alle.optLong(k)) }
        return auswahl
    }

    /** Überträgt die letzten Tage an die Web-App. Liefert die Anzahl übertragener Tage. */
    fun senden(c: Context): Int {
        val daten = zumSenden(c)
        if (daten.length() == 0) return 0
        Netz.webApp(c, "schritteSetzen", mapOf("daten" to daten.toString()))
        Speicher.prefs(c).edit().putLong("schritte_gesendet", System.currentTimeMillis()).apply()
        return daten.length()
    }

    /** Status für die Oberfläche. */
    fun status(c: Context): JSONObject = JSONObject()
        .put("sensor", sensorVorhanden(c))
        .put("erlaubt", erlaubt(c))
        .put("heute", heute(c))
        .put("tage", tage(c))
        .put("gesendet", Speicher.prefs(c).getLong("schritte_gesendet", 0))
}
