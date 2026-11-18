/*
 * Melder.kt – Benachrichtigungen anzeigen
 * Version: 0.7.0 (2026-11-18)
 *
 * Drei Kanäle, die man in den Android-Einstellungen auch einzeln abschalten kann:
 * Wochenziele (Erinnerung, Rückblick), Erfolge, App-Updates.
 */
package de.obitus.sport

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

object Melder {
    const val KANAL_ZIELE = "ziele"
    const val KANAL_ERFOLGE = "erfolge"
    const val KANAL_UPDATES = "updates"

    const val ID_ERINNERUNG = 1
    const val ID_RUECKBLICK = 2
    const val ID_ERFOLGE = 3
    const val ID_UPDATE = 4
    const val ID_TEST = 5

    fun kanaeleAnlegen(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(KANAL_ZIELE, "Wochenziele", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "Erinnerung unter der Woche und Wochenrückblick" })
        nm.createNotificationChannel(NotificationChannel(KANAL_ERFOLGE, "Erfolge", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "Neue Bestzeiten, Bestmarken und Abzeichen" })
        nm.createNotificationChannel(NotificationChannel(KANAL_UPDATES, "App-Updates", NotificationManager.IMPORTANCE_LOW)
            .apply { description = "Neue Version der App verfügbar" })
    }

    fun erlaubt(c: Context): Boolean =
        c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun appOeffnen(c: Context): PendingIntent = PendingIntent.getActivity(
        c, 0,
        Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    fun zeigen(c: Context, kanal: String, id: Int, titel: String, text: String, ziel: PendingIntent? = null) {
        if (!erlaubt(c)) return
        kanaeleAnlegen(c)
        val n = Notification.Builder(c, kanal)
            .setSmallIcon(R.drawable.ic_benachrichtigung)
            .setContentTitle(titel)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(ziel ?: appOeffnen(c))
            .build()
        c.getSystemService(NotificationManager::class.java).notify(id, n)
    }
}
