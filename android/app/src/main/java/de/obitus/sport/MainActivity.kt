/*
 * MainActivity.kt – Hülle um die Web-App (GitHub Pages)
 * Version: 0.7.0 (2026-11-18)
 *
 * Zeigt https://obitusde.github.io/sport/ in einem WebView. Die Oberfläche kommt also
 * weiterhin aus /docs und aktualisiert sich ohne neue APK. Über die Brücke „SportApp“
 * (siehe Bruecke) kann die Web-Oberfläche native Funktionen nutzen.
 * Links auf andere Seiten öffnen im Browser.
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
        private const val ANFRAGE_BENACHRICHTIGUNG = 1
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
                if (req.url.host == ERLAUBTER_HOST) return false
                startActivity(Intent(Intent.ACTION_VIEW, req.url))
                return true
            }
        }

        if (gespeichert == null || web.restoreState(gespeichert) == null) web.loadUrl(START_URL)

        benachrichtigungenErlauben()
        PruefJob.planen(this)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Zurück-Taste: erst in der Web-App zurück, dann App schließen")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    fun benachrichtigungenErlauben() {
        if (!Melder.erlaubt(this)) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), ANFRAGE_BENACHRICHTIGUNG)
    }

    override fun onRequestPermissionsResult(code: Int, rechte: Array<out String>, ergebnis: IntArray) {
        super.onRequestPermissionsResult(code, rechte, ergebnis)
        js("window.nativeGeaendert && window.nativeGeaendert()")
    }

    /** Zeigt einen Text als Meldung in der Web-Oberfläche. */
    fun meldungAnWeb(text: String) = js("window.nativeMeldung && window.nativeMeldung(" + JSONObject.quote(text) + ")")

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
}
