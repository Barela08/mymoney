package com.hackifypro.mymoney.upi

import org.json.JSONObject

/**
 * Normalized transaction models for Automatic UPI Notification Detection.
 * Product: My Money Manager by HackifyPro
 *
 * Monetary amounts are always stored as Long integer paise (minor currency units).
 * Missing fields remain null and are never fabricated.
 */
data class SupportedUpiApp(
    val id: String,
    val name: String,
    val packageNames: Set<String>,
    val parserKey: String,
    val defaultEnabled: Boolean = true
)

data class RawUpiNotification(
    val packageName: String,
    val title: String,
    val text: String,
    val bigText: String? = null,
    val subText: String? = null,
    val notificationTimestampMs: Long = System.currentTimeMillis(),
    val notificationKey: String? = null
)

data class DetectedUpiTransaction(
    val id: String,
    val amountPaise: Long,
    val currency: String = "INR",
    val sourceApp: String,
    val sourceAppId: String,
    val sourcePackage: String,
    val transactionDirection: String = "outgoing",
    val merchantName: String?,
    val upiId: String?,
    val upiTransactionId: String?,
    val utrNumber: String?,
    val rrn: String?,
    val transactionTimestampMs: Long,
    val notificationTimestampMs: Long,
    val paymentStatus: String = "completed",
    val rawDataHash: String,
    val detectionConfidence: Double,
    val verificationStatus: String,
    val parserVersion: String,
    val parserUsed: String
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("amountPaise", amountPaise)
        put("amountRupees", amountPaise / 100.0)
        put("currency", currency)
        put("sourceApp", sourceApp)
        put("sourceAppId", sourceAppId)
        put("sourcePackage", sourcePackage)
        put("transactionDirection", transactionDirection)
        put("merchantName", merchantName ?: JSONObject.NULL)
        put("upiId", upiId ?: JSONObject.NULL)
        put("upiTransactionId", upiTransactionId ?: JSONObject.NULL)
        put("utrNumber", utrNumber ?: JSONObject.NULL)
        put("rrn", rrn ?: JSONObject.NULL)
        put("transactionTimestamp", java.time.Instant.ofEpochMilli(transactionTimestampMs).toString())
        put("notificationTimestamp", java.time.Instant.ofEpochMilli(notificationTimestampMs).toString())
        put("paymentStatus", paymentStatus)
        put("rawDataHash", rawDataHash)
        put("detectionConfidence", detectionConfidence)
        put("verificationStatus", verificationStatus)
        put("parserVersion", parserVersion)
        put("parserUsed", parserUsed)
    }
}

data class UpiParseOutcome(
    val accepted: Boolean,
    val rejectionReason: String? = null,
    val parserUsed: String = "none",
    val parserVersion: String = UpiNotificationParserRegistry.PARSER_VERSION,
    val transaction: DetectedUpiTransaction? = null
)
