/*
 * MainActivity.kt – Hülle um die Web-App (GitHub Pages)
 * Version: 0.14.0 (2026-11-18)
 *
 * Zeigt https://obitusde.github.io/sport/ in einem WebView. Die Oberfläche kommt also
 * weiterhin aus /docs und aktualisiert sich ohne neue APK. Über die Brücke „SportApp“
 * (siehe Bruecke) kann die Web-Oberfläche native Funktionen nutzen.
 * Links auf andere Seiten öffnen im Browser.
 * Ab 0.8.0: fragt auch die Berechtigung „Körperliche Aktivität“ für den Schrittzähler an
 * und liest die Schritte beim Öffnen der App.
 * Ab 0.14.0: Im WebView bleibt nur /sport/; andere Seiten unter obitusde.github.io (z. B. der
 * Fotoschatz) öffnen im Browser.
 */
package de.obitus.sport

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

class MainActivity : Activity() {

    companion object {
        const val START_URL = "https://obitusde.github.io/sport/"
        private const val ERLAUBTER_HOST = "obitusde.github.io"
        private const val ERLAUBTER_PFAD = "/sport"
        private const val ANFRAGE_BERECHTIGUNGEN = 1
    }

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(gespeichert: Bundle?) {
        super.onCreate(gespeichert)
        Melder.kanaeleAnlegen(this)

        // Randlos zeichnen und Systemleisten selbst als Abstand berücksichtigen
        window.setDecorFitsSystemWindows(false)
        val dunkel = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val hell = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
        window.insetsController?.setSystemBarsAppearance(if (dunkel) 0 else hell, hell)

        val wurzel = FrameLayout(this)
        wurzel.setBackgroundColor(getColor(R.color.hintergrund))
        web = WebView(this)
        web.setBackgroundColor(getColor(R.color.hintergrund))
        wurzel.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(wurzel)
        wurzel.setOnApplyWindowInsetsListener { v, insets ->
            val r = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
            v.setPadding(r.left, r.top, r.right, r.bottom)
            WindowInsets.CONSUMED
        }

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.setSupportZoom(false)
        web.addJavascriptInterface(Bruecke(this), "SportApp")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                // Nur die Sport-App selbst im WebView; alles andere (auch der Fotoschatz unter
                // derselben Adresse) im Browser, damit die Sport-App nicht ersetzt wird
                if (req.url.host == ERLAUBTER_HOST && (req.url.path ?: "").startsWith(ERLAUBTER_PFAD)) return false
                startActivity(Intent(Intent.ACTION_VIEW, req.url))
                return true
            }
        }

        if (gespeichert == null || web.restoreState(gespeichert) == null) web.loadUrl(START_URL)

        berechtigungenAnfragen()
        PruefJob.planen(this)
    }

    override fun onResume() {
        super.onResume()
        schritteAktualisieren(senden = false)
    }

    /** Liest die Schritte im Hintergrund und meldet der Oberfläche den neuen Stand. */
    fun schritteAktualisieren(senden: Boolean) {
        if (!Schritte.erlaubt(this)) return
        Thread {
            try {
                Schritte.aktualisieren(this)
                val p = Speicher.prefs(this)
                if (Speicher.hatVerbindung(this) &&
                    (senden || System.currentTimeMillis() - p.getLong("schritte_gesendet", 0) > 10 * 60 * 1000L)) {
                    Schritte.senden(this)
                }
            } catch (e: Exception) {
                // Netz oder Sensor nicht verfügbar: beim nächsten Mal wieder
            }
            js("window.nativeSchritte && window.nativeSchritte()")
        }.start()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Zurück-Taste: erst in der Web-App zurück, dann App schließen")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    /** Fragt fehlende Berechtigungen an: Benachrichtigungen und körperliche Aktivität (Schritte). */
    fun berechtigungenAnfragen() {
        val fehlt = mutableListOf<String>()
        if (!Melder.erlaubt(this)) fehlt.add(Manifest.permission.POST_NOTIFICATIONS)
        if (!Schritte.erlaubt(this)) fehlt.add(Manifest.permission.ACTIVITY_RECOGNITION)
        if (fehlt.isNotEmpty()) requestPermissions(fehlt.toTypedArray(), ANFRAGE_BERECHTIGUNGEN)
    }

    override fun onRequestPermissionsResult(code: Int, rechte: Array<out String>, ergebnis: IntArray) {
        super.onRequestPermissionsResult(code, rechte, ergebnis)
        schritteAktualisieren(senden = false)
        js("window.nativeGeaendert && window.nativeGeaendert()")
    }

    /** Zeigt einen Text als Meldung in der Web-Oberfläche. */
    fun meldungAnWeb(text: String) = js("window.nativeMeldung && window.nativeMeldung(" + JSONObject.quote(text) + ")")

    fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
}
