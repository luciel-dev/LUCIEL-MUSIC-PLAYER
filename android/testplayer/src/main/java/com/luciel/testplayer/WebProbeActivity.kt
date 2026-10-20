package com.luciel.testplayer

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient

/** Plain WebView with a ticking page: tells apart "this emulator's WebView renderer is broken" from app bugs. */
class WebProbeActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val w = WebView(this); setContentView(w)
        w.settings.javaScriptEnabled = true
        w.webChromeClient = object : WebChromeClient() { override fun onConsoleMessage(m: ConsoleMessage): Boolean { Log.i("WebProbe", m.message()); return true } }
        w.webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean { Log.w("WebProbe", "renderer gone crash=${detail.didCrash()}"); finish(); return true }
        }
        w.loadDataWithBaseURL(null, "<body style='background:#234;color:#fff'><h1 id=t>probe</h1><script>let n=0;setInterval(()=>{document.getElementById('t').textContent='tick '+(++n);console.log('tick '+n)},1000)</script>", "text/html", "utf-8", null)
    }
}
