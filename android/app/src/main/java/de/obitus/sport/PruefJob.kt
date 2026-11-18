/*
 * PruefJob.kt – Hintergrund-Job (JobScheduler), etwa alle 30 Minuten
 * Version: 0.7.0 (2026-11-18)
 *
 * Läuft nur mit Netz, übersteht Neustarts (setPersisted). Die Arbeit macht Pruefung.laufen.
 */
package de.obitus.sport

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log

class PruefJob : JobService() {

    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            try {
                Pruefung.laufen(applicationContext)
            } catch (e: Exception) {
                Log.w("SportPruefJob", "Fehler: ${e.message}")
            } finally {
                jobFinished(params, false)
            }
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    companion object {
        private const val ID = 1
        private const val INTERVALL = 30 * 60 * 1000L

        /** Plant den Job, falls er noch nicht (oder mit anderem Intervall) geplant ist. */
        fun planen(c: Context) {
            val js = c.getSystemService(JobScheduler::class.java)
            val vorhanden = js.getPendingJob(ID)
            if (vorhanden != null && vorhanden.intervalMillis == INTERVALL) return
            js.schedule(
                JobInfo.Builder(ID, ComponentName(c, PruefJob::class.java))
                    .setPeriodic(INTERVALL)
                    .setPersisted(true)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .build()
            )
        }
    }
}
