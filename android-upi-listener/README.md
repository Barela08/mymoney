# Android Native UPI Notification Listener Module

**Product:** My Money Manager by HackifyPro

## Overview
This directory contains the native Android Kotlin implementation required for live cross-app UPI payment notification detection via Android's `NotificationListenerService`.

Because standard web browsers and iOS do not permit third-party apps to read notifications posted by other applications (Google Pay, PhonePe, Paytm, BHIM), live background notification capture requires wrapping the web app inside an Android WebView or Capacitor shell with this module attached.

## Included Files
- `DetectedTransactionModels.kt` — Normalized transaction DTOs using integer paise (`amountPaise`) and nullable provider references.
- `UpiNotificationParsers.kt` — Versioned parser registry (`GooglePayNotificationParser`, `PhonePeNotificationParser`, `PaytmNotificationParser`, `BHIMNotificationParser`, `GenericUpiNotificationParser`) with strict OTP/PIN/incoming/failed rejection and deduplication.
- `UpiNotificationListenerService.kt` — Extends `NotificationListenerService`, honors user Enable/Disable settings, writes an offline-safe pending queue, emits local broadcasts to the WebView bridge, and posts non-invasive high-priority categorization notifications (no `SYSTEM_ALERT_WINDOW` abuse).
- `UpiDetectionBridge.kt` — Exposes `window.HackifyProUpiBridge` to the web application for real OS permission verification (`getNotificationAccessStatus()`), opening Android Notification Access Settings (`openNotificationAccessSettings()`), toggling detection, and draining the offline queue.
- `AndroidManifest.xml` — Service declaration with `BIND_NOTIFICATION_LISTENER_SERVICE` and `POST_NOTIFICATIONS`.

## Integration Steps (Android Studio / Capacitor)
1. Copy `src/main/java/com/hackifypro/mymoney/upi/*` into your Android project's `app/src/main/java/com/hackifypro/mymoney/upi/`.
2. Merge the `<service>` entry from `AndroidManifest.xml` into your `app/src/main/AndroidManifest.xml`.
3. Register the JavaScript bridge on your host `WebView`:
   ```kotlin
   webView.addJavascriptInterface(UpiDetectionBridge(this), "HackifyProUpiBridge")
   ```
4. Register a `BroadcastReceiver` in your host `Activity` for `UpiNotificationListenerService.ACTION_UPI_EXPENSE_DETECTED` and forward the JSON payload to the web app via:
   ```kotlin
   webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('hackifypro:upi-detected', { detail: $json }));", null)
   ```
5. Build a debug APK in Android Studio (`./gradlew assembleDebug`) and test on a physical Android device (Android 10–15) by granting Notification Access in Android Settings and sending real/test UPI payments.
