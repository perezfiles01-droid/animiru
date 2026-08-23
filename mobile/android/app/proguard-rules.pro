# ProGuard rules for the Animiru WebView shell.

# Keep any @JavascriptInterface members so the JS bridge survives shrinking.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep public class * extends android.app.Activity
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
