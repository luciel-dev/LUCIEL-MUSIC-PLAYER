package com.luciel.player

import android.Manifest
import android.annotation.SuppressLint
import android.app.RecoverableSecurityException
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

class MainActivity : ComponentActivity() {

    lateinit var web: WebView; private set
    private lateinit var bridge: WebBridge
    private lateinit var content: LocalContent
    private val prefs by lazy { Prefs.get(this) }
    private var pageReady = false
    private val pendingJs = mutableListOf<String>()
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pickId = 0
    private var treeAudioOnly = true
    private var permId = 0
    private var pendingWrite: Triple<Int, Uri, ByteArray>? = null
    private var pendingRename: Triple<Int, Uri, String>? = null
    private var pendingSave: Pair<Int, ByteArray>? = null
    private val extListener: (ExtTrack?) -> Unit = { t -> js("window.LucielAndroidBridge&&LucielAndroidBridge.ext(" + WebBridge.extJson(t) + ")") }

    // ---------------------------------------------------------------- activity results
    private val pickAudioLauncher = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { u -> try { contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Throwable) {} }
        bridge.resolve(pickId, true, LibraryScanner.describe(this, uris).toString())
    }
    private val treeLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        if (tree == null) { bridge.resolve(pickId, true, "[]"); return@registerForActivityResult }
        try { contentResolver.takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Throwable) {}
        val id = pickId; val audioOnly = treeAudioOnly
        Thread { val r = try { LibraryScanner.walkTree(this, tree, audioOnly).toString() } catch (e: Throwable) { "[]" }; bridge.resolve(id, true, r) }.start()
    }
    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        bridge.resolve(permId, true, granted.toString()); pushPerms()
    }
    private val consentLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r ->
        val ok = r.resultCode == RESULT_OK
        pendingWrite?.let { (id, uri, bytes) -> pendingWrite = null; if (ok) doWrite(id, uri, bytes, retry = false) else bridge.resolve(id, false, JSONObject.quote("Android didn't allow changing this file")) }
        pendingRename?.let { (id, uri, name) -> pendingRename = null; if (ok) doRename(id, uri, name, retry = false) else bridge.resolve(id, false, JSONObject.quote("Android didn't allow renaming this file")) }
    }
    private val createDocLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("audio/*")) { uri ->
        val p = pendingSave ?: return@registerForActivityResult; pendingSave = null
        if (uri == null) { bridge.resolve(p.first, true, "{\"cancelled\":true}"); return@registerForActivityResult }
        try { contentResolver.openOutputStream(uri, "wt")?.use { it.write(p.second) }; bridge.resolve(p.first, true, JSONObject().put("uri", uri.toString()).put("name", displayName(uri)).toString()) }
        catch (e: Throwable) { bridge.resolve(p.first, false, JSONObject.quote(e.message ?: "save failed")) }
    }
    private val chooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback; fileCallback = null
        cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
    }

    // ---------------------------------------------------------------- lifecycle
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        content = LocalContent(this)
        bridge = WebBridge(this)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        WebBridge.webRef = WeakReference(web)
        web.setBackgroundColor(Color.parseColor("#1B2A3A"))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        with(web.settings) {
            javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false; allowContentAccess = false
            setSupportZoom(false); builtInZoomControls = false; displayZoomControls = false; textZoom = 100
            cacheMode = WebSettings.LOAD_NO_CACHE; offscreenPreRaster = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString LucielAndroid/${BuildConfig.VERSION_NAME}"
        }
        // keep decoding audio when the screen is off / app is in the background
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        web.addJavascriptInterface(bridge, "LucielAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = content.intercept(request)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == LocalContent.HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Throwable) {}
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pushInsets(); pushPerms()
                pendingJs.forEach { web.evaluateJavascript(it, null) }; pendingJs.clear()
                handleIntent(intent, fresh = true)
            }
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // renderer crashed / was killed: rebuild instead of letting the whole app die
                Log.w("Luciel", "renderer gone (crash=${detail.didCrash()})")
                val now = System.currentTimeMillis(); rendererDeaths.addLast(now); while (rendererDeaths.first() < now - 180_000) rendererDeaths.removeFirst()
                recreate(); return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean { Log.d("LucielJS", "${m.messageLevel()} ${m.message()} @${m.sourceId()?.substringAfterLast('/')}:${m.lineNumber()}"); return true }
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                val i = params.createIntent().apply {
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    val acc = params.acceptTypes.filter { it.isNotBlank() }
                    if (acc.any { it.contains("zip") }) { type = "*/*"; putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) }
                }
                return try { chooserLauncher.launch(i); true } catch (e: ActivityNotFoundException) { fileCallback = null; false }
            }
        }
        setContentView(web)
        ViewCompat.setOnApplyWindowInsetsListener(web) { _, insets -> lastInsets = insets; pushInsets(); insets }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!pageReady) { moveTaskToBack(true); return }
                web.evaluateJavascript("(window.LucielAndroidBridge&&LucielAndroidBridge.back())||false") { r ->
                    if (r != "true") { if (prefs.backgroundPlay) moveTaskToBack(true) else finish() }
                }
            }
        })
        // two renderer deaths within 3 minutes (low-memory phone): come back in "safe" mode without the heavy extras
        val safe = rendererDeaths.size >= 2
        val dbgUrl = if (BuildConfig.DEBUG) intent?.getStringExtra("debugPath") else null   // debug builds only: test pages
        web.loadUrl(LocalContent.ORIGIN + (dbgUrl ?: ("/index.html" + if (safe) "?safe=1" else "")))
        NowPlayingHub.listeners.add(extListener)
        // only on a fresh start: a recreate (rotation, WebView renderer restart) must not stack another onboarding screen
        if (!prefs.onboarded && savedInstanceState == null) startActivity(Intent(this, OnboardingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if (pageReady) handleIntent(intent, fresh = false) }

    override fun onStart() { super.onStart(); ensurePlaybackService() }
    override fun onResume() { super.onResume(); OverlayController.appInFront = true; if (pageReady) { pushPerms(); js("window.LucielAndroidBridge&&LucielAndroidBridge.visible(true)") } }
    override fun onPause() { OverlayController.appInFront = false; if (pageReady) js("window.LucielAndroidBridge&&LucielAndroidBridge.visible(false)"); super.onPause() }

    override fun onDestroy() {
        NowPlayingHub.listeners.remove(extListener)
        NowPlayingHub.useBeats("app", false)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        if (WebBridge.webRef?.get() === web) WebBridge.webRef = null
        web.destroy()
        super.onDestroy()
    }

    @OptIn(UnstableApi::class)
    fun ensurePlaybackService() {
        if (controllerFuture != null) return
        // connecting a controller creates + binds the session service; Media3 promotes it to a foreground service while playing
        controllerFuture = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
    }

    fun js(code: String) { if (pageReady) web.evaluateJavascript(code, null) else pendingJs += code }

    // ---------------------------------------------------------------- insets / bars
    private var lastInsets: WindowInsetsCompat? = null
    private fun pushInsets() {
        val i = lastInsets ?: return
        val b = i.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val ime = i.getInsets(WindowInsetsCompat.Type.ime()).bottom
        val d = resources.displayMetrics.density
        js("window.LucielAndroidBridge&&LucielAndroidBridge.insets(${b.top / d},${b.right / d},${maxOf(b.bottom, ime) / d},${b.left / d})")
    }
    /** full-screen visuals: hide status + navigation bars (an edge swipe shows them for a moment) */
    fun setBarsHidden(on: Boolean) {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (on) { c.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; c.hide(WindowInsetsCompat.Type.systemBars()) }
        else c.show(WindowInsetsCompat.Type.systemBars())
    }
    fun setBars(bg: String, lightIcons: Boolean) {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.isAppearanceLightStatusBars = !lightIcons; c.isAppearanceLightNavigationBars = !lightIcons
        try { web.setBackgroundColor(Color.parseColor(bg)) } catch (_: Throwable) {}
    }
    fun pushPerms() = js("window.LucielAndroidBridge&&LucielAndroidBridge.perms(" + bridge.perms() + ")")

    // ---------------------------------------------------------------- intents (open with / share / overlay tap)
    private fun handleIntent(i: Intent?, fresh: Boolean) {
        i ?: return
        val uris = mutableListOf<Uri>()
        when (i.action) {
            Intent.ACTION_VIEW -> i.data?.let { uris += it }
            Intent.ACTION_SEND -> (if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM))?.let { uris += it }
            Intent.ACTION_SEND_MULTIPLE -> (if (Build.VERSION.SDK_INT >= 33) i.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") i.getParcelableArrayListExtra(Intent.EXTRA_STREAM))?.let { uris += it }
            ACTION_EXT_MODE -> { js("window.LucielAndroidBridge&&LucielAndroidBridge.extMode(true)"); i.action = null; return }
        }
        if (uris.isEmpty()) return
        val zips = uris.filter { u -> (contentResolver.getType(u) ?: "").contains("zip") || displayName(u).endsWith(".zip", true) }
        val audio = uris - zips.toSet()
        if (audio.isNotEmpty()) js("window.LucielAndroidBridge&&LucielAndroidBridge.openUris(" + LibraryScanner.describe(this, audio) + ")")
        if (zips.isNotEmpty()) js("window.LucielAndroidBridge&&LucielAndroidBridge.importPacks(" + LibraryScanner.describe(this, zips) + ")")
        i.action = null   // don't re-add on recreate
    }

    fun displayName(u: Uri): String = try { contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } } catch (_: Throwable) { null } ?: (u.lastPathSegment ?: "file")

    // ---------------------------------------------------------------- pickers / permissions
    fun pickAudio(id: Int) { pickId = id; try { pickAudioLauncher.launch(arrayOf("audio/*", "application/ogg", "video/webm")) } catch (e: Throwable) { bridge.resolve(id, false, JSONObject.quote("no file picker")) } }
    fun pickTree(id: Int, audioOnly: Boolean) { pickId = id; treeAudioOnly = audioOnly; try { treeLauncher.launch(null) } catch (e: Throwable) { bridge.resolve(id, false, JSONObject.quote("no folder picker")) } }
    fun requestAudioPermission(id: Int) {
        permId = id
        val p = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
        if (checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) bridge.resolve(id, true, "true") else permLauncher.launch(p)
    }

    // ---------------------------------------------------------------- tag editor: write back to the file
    fun writeWithConsent(id: Int, uri: Uri, bytes: ByteArray) = doWrite(id, uri, bytes, retry = true)
    private fun doWrite(id: Int, uri: Uri, bytes: ByteArray, retry: Boolean) {
        try {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: throw IllegalStateException("can't open file")
            bridge.resolve(id, true, JSONObject.quote(uri.toString()))
        } catch (e: SecurityException) {
            val sender = consentFor(uri, e)
            if (retry && sender != null) { pendingWrite = Triple(id, uri, bytes); consentLauncher.launch(IntentSenderRequest.Builder(sender).build()) }
            else bridge.resolve(id, false, JSONObject.quote("No permission to change this file"))
        } catch (e: Throwable) { bridge.resolve(id, false, JSONObject.quote(e.message ?: "write failed")) }
    }
    fun renameWithConsent(id: Int, uri: Uri, name: String) = doRename(id, uri, name, retry = true)
    private fun doRename(id: Int, uri: Uri, name: String, retry: Boolean) {
        try {
            if (uri.authority == "media") {
                contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, name) }, null, null)
                bridge.resolve(id, true, JSONObject.quote(uri.toString()))
            } else {
                val nu = android.provider.DocumentsContract.renameDocument(contentResolver, uri, name) ?: uri
                bridge.resolve(id, true, JSONObject.quote(nu.toString()))
            }
        } catch (e: SecurityException) {
            val sender = consentFor(uri, e)
            if (retry && sender != null) { pendingRename = Triple(id, uri, name); consentLauncher.launch(IntentSenderRequest.Builder(sender).build()) }
            else bridge.resolve(id, false, JSONObject.quote("No permission to rename this file"))
        } catch (e: Throwable) { bridge.resolve(id, false, JSONObject.quote(e.message ?: "rename failed")) }
    }
    private fun consentFor(uri: Uri, e: SecurityException): android.content.IntentSender? = when {
        uri.authority != "media" -> null
        Build.VERSION.SDK_INT >= 30 -> MediaStore.createWriteRequest(contentResolver, listOf(uri)).intentSender
        Build.VERSION.SDK_INT == 29 && e is RecoverableSecurityException -> e.userAction.actionIntent.intentSender
        else -> null
    }
    fun saveAs(id: Int, name: String, @Suppress("UNUSED_PARAMETER") mime: String, bytes: ByteArray) {
        pendingSave = id to bytes
        try { createDocLauncher.launch(name) } catch (e: Throwable) { pendingSave = null; bridge.resolve(id, false, JSONObject.quote("no save dialog")) }
    }

    // ---------------------------------------------------------------- system screens
    fun openSystem(what: String) {
        val i = when (what) {
            "listener" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            "app" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "onboarding" -> Intent(this, OnboardingActivity::class.java).putExtra("again", true)
            "overlaySettings" -> Intent(this, OverlaySettingsActivity::class.java)
            "spotify" -> packageManager.getLaunchIntentForPackage(Prefs.SPOTIFY) ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${Prefs.SPOTIFY}"))
            else -> null
        } ?: return
        try { startActivity(i) } catch (_: Throwable) { try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (_: Throwable) {} }
    }

    @Suppress("unused") private fun JSONArray.isEmpty() = length() == 0

    companion object {
        const val ACTION_EXT_MODE = "com.luciel.player.EXT_MODE"
        private val rendererDeaths = ArrayDeque<Long>()
    }
}
