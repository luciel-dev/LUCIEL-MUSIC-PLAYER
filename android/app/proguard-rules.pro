# JS bridge methods are called by name from the WebView
-keepclassmembers class com.luciel.player.WebBridge { @android.webkit.JavascriptInterface <methods>; }
-keepattributes JavascriptInterface
