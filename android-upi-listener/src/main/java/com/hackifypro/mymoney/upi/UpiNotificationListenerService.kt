package com.hackifypro.mymoney.upi

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native Android NotificationListenerService for Automatic UPI Expense Detection.
 * Product: My Money Manager by HackifyPro
 *
 * Security & Compliance:
 * - Only inspects notifications from user-enabled UPI payment package names.
 * - Immediately discards OTP, UPI PIN, incoming transfer, failed/pending, and non-payment alerts.
 * - Stops all processing immediately when user disables Automatic Detection in Settings.
 * - Uses standard high-priority notification with categorization action/deep-link
 *   instead of invasive SYSTEM_ALERT_WINDOW overlays.
 * - Persists offline queue locally so detections survive process kill / network outage.
 */
class UpiNotificationListenerService : NotificationListenerService() {

    companion object {
        private const val TAG = "HackifyProUpiListener"
        const val PREFS_NAME = "hackifypro_upi_detection_prefs"
        const val KEY_ENABLED = "detection_enabled"
        const val KEY_AUTO_POPUP = "auto_popup_enabled"
        const val KEY_ENABLED_APPS = "enabled_apps_csv"
        const val KEY_PENDING_QUEUE = "pending_detected_queue_json"
        const val CHANNEL_ID = "hackifypro_upi_expense_popup"
        const val ACTION_UPI_EXPENSE_DETECTED = "com.hackifypro.mymoney.ACTION_UPI_EXPENSE_DETECTED"
        const val EXTRA_DETECTED_JSON = "extra_detected_transaction_json"

        fun requestRebindIfEnabled(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (!prefs.getBoolean(KEY_ENABLED, false)) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    requestRebind(ComponentName(context, UpiNotificationListenerService::class.java))
                } catch (e: Exception) {
                    Log.w(TAG, "Unable to request NotificationListener rebind: ${e.message}")
                }
            }
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        ensureNotificationChannel()
        Log.i(TAG, "UpiNotificationListenerService connected.")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.i(TAG, "UpiNotificationListenerService disconnected.")
        requestRebindIfEnabled(applicationContext)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // Respect user's Enable / Disable toggle strictly
        if (!prefs.getBoolean(KEY_ENABLED, false)) return

        val packageName = sbn.packageName ?: return
        val app = UpiNotificationParserRegistry.resolveApp(packageName) ?: return

        val enabledAppsCsv = prefs.getString(KEY_ENABLED_APPS, null)
        val enabledAppIds = enabledAppsCsv
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?.toSet()

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()

        val raw = RawUpiNotification(
            packageName = packageName,
            title = title,
            text = text,
            bigText = bigText,
            subText = subText,
            notificationTimestampMs = sbn.postTime,
            notificationKey = sbn.key
        )

        val outcome = UpiNotificationParserRegistry.parse(raw, enabledAppIds)
        if (!outcome.accepted || outcome.transaction == null) {
            return
        }

        val detected = outcome.transaction
        val existingQueue = loadPendingQueue(prefs)
        if (BaseUpiParsingCore.isDuplicate(detected, existingQueue)) {
            Log.d(TAG, "Duplicate UPI notification ignored for ${app.name}")
            return
        }

        // Persist to offline-safe queue
        val updatedQueue = (listOf(detected) + existingQueue).take(100)
        savePendingQueue(prefs, updatedQueue)

        // Dispatch local broadcast for active WebView / Capacitor bridge
        val broadcastIntent = Intent(ACTION_UPI_EXPENSE_DETECTED).apply {
            setPackage(applicationContext.packageName)
            putExtra(EXTRA_DETECTED_JSON, detected.toJson().toString())
        }
        sendBroadcast(broadcastIntent)

        // Show non-invasive high-priority categorization notification when app is backgrounded
        if (prefs.getBoolean(KEY_AUTO_POPUP, true)) {
            showCategorizationNotification(detected)
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Automatic UPI Expense Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Instant prompts to categorize outgoing UPI payments in My Money Manager by HackifyPro."
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun showCategorizationNotification(tx: DetectedUpiTransaction) {
        ensureNotificationChannel()
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_DETECTED_JSON, tx.toJson().toString())
            putExtra("deep_link", "upi-categorize/${tx.id}")
        } ?: return

        val pendingIntent = PendingIntent.getActivity(
            this,
            tx.id.hashCode(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val rupeesDisplay = "₹${"%.2f".format(tx.amountPaise / 100.0).removeSuffix(".00")}"
        val merchantPart = tx.merchantName?.let { " to $it" }.orEmpty()

        val publicFallback = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("My Money Manager")
            .setContentText("New UPI transaction detected. Unlock to categorize.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("My Money Manager · Expense Detected ($rupeesDisplay)")
            .setContentText("Paid$merchantPart via ${tx.sourceApp}. Tap to pick a category.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicFallback)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(tx.id.hashCode(), notification)
    }

    private fun loadPendingQueue(prefs: android.content.SharedPreferences): List<DetectedUpiTransaction> {
        val rawJson = prefs.getString(KEY_PENDING_QUEUE, "[]") ?: "[]"
        return try {
            val arr = JSONArray(rawJson)
            val list = mutableListOf<DetectedUpiTransaction>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    DetectedUpiTransaction(
                        id = obj.getString("id"),
                        amountPaise = obj.getLong("amountPaise"),
                        sourceApp = obj.getString("sourceApp"),
                        sourceAppId = obj.optString("sourceAppId", "generic_upi"),
                        sourcePackage = obj.getString("sourcePackage"),
                        merchantName = obj.optString("merchantName").takeIf { it.isNotBlank() && it != "null" },
                        upiId = obj.optString("upiId").takeIf { it.isNotBlank() && it != "null" },
                        upiTransactionId = obj.optString("upiTransactionId").takeIf { it.isNotBlank() && it != "null" },
                        utrNumber = obj.optString("utrNumber").takeIf { it.isNotBlank() && it != "null" },
                        rrn = obj.optString("rrn").takeIf { it.isNotBlank() && it != "null" },
                        transactionTimestampMs = obj.optLong("transactionTimestampMs", System.currentTimeMillis()),
                        notificationTimestampMs = obj.optLong("notificationTimestampMs", System.currentTimeMillis()),
                        rawDataHash = obj.optString("rawDataHash", ""),
                        detectionConfidence = obj.optDouble("detectionConfidence", 0.6),
                        verificationStatus = obj.optString("verificationStatus", "unverified"),
                        parserVersion = obj.optString("parserVersion", UpiNotificationParserRegistry.PARSER_VERSION),
                        parserUsed = obj.optString("parserUsed", "GenericUpiNotificationParser")
                    )
                )
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun savePendingQueue(prefs: android.content.SharedPreferences, queue: List<DetectedUpiTransaction>) {
        val arr = JSONArray()
        for (item in queue) {
            arr.put(item.toJson().apply {
                put("transactionTimestampMs", item.transactionTimestampMs)
                put("notificationTimestampMs", item.notificationTimestampMs)
            })
        }
        prefs.edit().putString(KEY_PENDING_QUEUE, arr.toString()).apply()
    }
}
