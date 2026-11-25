package com.hackifypro.mymoney.upi

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray

/**
 * WebView / Capacitor JavaScript Bridge for Automatic UPI Detection.
 * Expose to WebView via:
 *   webView.addJavascriptInterface(UpiDetectionBridge(context), "HackifyProUpiBridge")
 *
 * Product: My Money Manager by HackifyPro
 */
class UpiDetectionBridge(private val context: Context) {

    private val prefs = context.getSharedPreferences(
        UpiNotificationListenerService.PREFS_NAME,
        Context.MODE_PRIVATE
    )

    /**
     * Checks actual OS-level Android Notification Listener permission state.
     * Never assumes granted simply because Settings was opened.
     */
    @JavascriptInterface
    fun getNotificationAccessStatus(): String {
        val enabledPackages = NotificationManagerCompat.getEnabledListenerPackages(context)
        val hasOsGrant = enabledPackages.contains(context.packageName)
        if (!hasOsGrant) {
            return "not_granted"
        }
        val userEnabled = prefs.getBoolean(UpiNotificationListenerService.KEY_ENABLED, false)
        return if (userEnabled) "granted" else "disabled"
    }

    /**
     * Opens Android Notification Access Settings directly so the user can grant
     * or revoke Notification Listener access transparently.
     */
    @JavascriptInterface
    fun openNotificationAccessSettings(): Boolean {
        return try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun setDetectionEnabled(enabled: Boolean): Boolean {
        prefs.edit().putBoolean(UpiNotificationListenerService.KEY_ENABLED, enabled).apply()
        if (enabled) {
            UpiNotificationListenerService.requestRebindIfEnabled(context)
        }
        return true
    }

    @JavascriptInterface
    fun setAutoPopupEnabled(enabled: Boolean): Boolean {
        prefs.edit().putBoolean(UpiNotificationListenerService.KEY_AUTO_POPUP, enabled).apply()
        return true
    }

    @JavascriptInterface
    fun setSupportedAppsCsv(csv: String): Boolean {
        prefs.edit().putString(UpiNotificationListenerService.KEY_ENABLED_APPS, csv).apply()
        return true
    }

    @JavascriptInterface
    fun getPendingQueueJson(): String {
        return prefs.getString(UpiNotificationListenerService.KEY_PENDING_QUEUE, "[]") ?: "[]"
    }

    @JavascriptInterface
    fun clearPendingQueueItem(detectedId: String): Boolean {
        val current = JSONArray(getPendingQueueJson())
        val next = JSONArray()
        for (i in 0 until current.length()) {
            val obj = current.getJSONObject(i)
            if (obj.optString("id") != detectedId) {
                next.put(obj)
            }
        }
        prefs.edit().putString(UpiNotificationListenerService.KEY_PENDING_QUEUE, next.toString()).apply()
        return true
    }

    @JavascriptInterface
    fun isServiceComponentEnabled(): Boolean {
        val cn = ComponentName(context, UpiNotificationListenerService::class.java)
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
        return flat?.contains(cn.flattenToString()) == true
    }
}
