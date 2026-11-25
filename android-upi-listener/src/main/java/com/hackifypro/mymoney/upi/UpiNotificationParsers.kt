package com.hackifypro.mymoney.upi

import java.security.MessageDigest
import kotlin.math.abs

/**
 * Versioned, configurable UPI Notification Parsers for Android.
 * Product: My Money Manager by HackifyPro
 *
 * Mirrors the server/TypeScript parser contract strictly:
 * - Rejects OTPs, UPI PINs, CVVs, banking credentials, promotional alerts,
 *   collect requests, incoming transfers, failed/pending payments.
 * - Never invents missing UTR/RRN/UPI Transaction IDs, merchant names, or amounts.
 */
interface UpiNotificationParser {
    val parserName: String
    fun parse(input: RawUpiNotification, app: SupportedUpiApp): UpiParseOutcome
}

object UpiNotificationParserRegistry {
    const val PARSER_VERSION = "1.0.0"

    val supportedApps: List<SupportedUpiApp> = listOf(
        SupportedUpiApp(
            id = "google_pay",
            name = "Google Pay",
            packageNames = setOf("com.google.android.apps.nbu.paisa.user"),
            parserKey = "google_pay",
            defaultEnabled = true
        ),
        SupportedUpiApp(
            id = "phonepe",
            name = "PhonePe",
            packageNames = setOf("com.phonepe.app"),
            parserKey = "phonepe",
            defaultEnabled = true
        ),
        SupportedUpiApp(
            id = "paytm",
            name = "Paytm",
            packageNames = setOf("net.one97.paytm"),
            parserKey = "paytm",
            defaultEnabled = true
        ),
        SupportedUpiApp(
            id = "bhim",
            name = "BHIM UPI",
            packageNames = setOf("in.org.npci.upiapp"),
            parserKey = "bhim",
            defaultEnabled = true
        ),
        SupportedUpiApp(
            id = "amazon_pay",
            name = "Amazon Pay UPI",
            packageNames = setOf("in.amazon.mShop.android.shopping"),
            parserKey = "generic_upi",
            defaultEnabled = true
        ),
        SupportedUpiApp(
            id = "cred",
            name = "CRED UPI",
            packageNames = setOf("com.dreamplug.androidapp"),
            parserKey = "generic_upi",
            defaultEnabled = true
        ),
        SupportedUpiApp(
            id = "generic_upi",
            name = "Other Supported UPI Apps",
            packageNames = setOf(
                "com.whatsapp",
                "com.mobikwik_new",
                "in.org.npci.upiapp.sbi",
                "com.sbi.upi",
                "com.csam.icici.bank.imobile",
                "com.snapwork.hdfc",
                "com.axis.mobile",
                "com.freecharge.android"
            ),
            parserKey = "generic_upi",
            defaultEnabled = false
        )
    )

    private val parsers: Map<String, UpiNotificationParser> = mapOf(
        "google_pay" to GooglePayNotificationParser(),
        "phonepe" to PhonePeNotificationParser(),
        "paytm" to PaytmNotificationParser(),
        "bhim" to BHIMNotificationParser(),
        "generic_upi" to GenericUpiNotificationParser()
    )

    fun resolveApp(packageName: String): SupportedUpiApp? {
        val pkg = packageName.trim().lowercase()
        return supportedApps.firstOrNull { app -> app.packageNames.any { it.lowercase() == pkg } }
    }

    fun parse(input: RawUpiNotification, enabledAppIds: Set<String>? = null): UpiParseOutcome {
        val app = resolveApp(input.packageName)
            ?: return UpiParseOutcome(accepted = false, rejectionReason = "unsupported_package")

        if (enabledAppIds != null && !enabledAppIds.contains(app.id)) {
            return UpiParseOutcome(accepted = false, rejectionReason = "app_disabled_by_user")
        }

        val parser = parsers[app.parserKey] ?: GenericUpiNotificationParser()
        return parser.parse(input, app)
    }

    fun sha256Hex(raw: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun maskForLogs(text: String): String = text
        .replace(Regex("""\b(otp|pin|mpin|upi\s*pin|cvv|passcode|password)\s*[:=-]?\s*[a-zA-Z0-9]{3,10}\b""", RegexOption.IGNORE_CASE), "$1: [REDACTED]")
        .replace(Regex("""\b([a-zA-Z0-9._-]{2})[a-zA-Z0-9._-]*(@[a-zA-Z]{2,})\b"""), "$1***$2")
        .replace(Regex("""\b(\d{4,})(\d{4})\b""")) { m -> "****${m.groupValues[2]}" }
}

internal object BaseUpiParsingCore {
    private val SENSITIVE_OR_NON_PAYMENT = Regex(
        """\b(otp|one[\s-]?time\s+password|upi\s*pin|m[\s-]?pin|mpin|cvv|verification\s+code|login\s+code|do\s+not\s+share|secret\s+code|cashback\s+offer|scratch\s+card|refer\s+and\s+earn|win\s+upto|kyc\s+update|bill\s+reminder|collect\s+request|requested\s+₹|has\s+requested\s+rs\.?|available\s+balance|account\s+balance)\b""",
        RegexOption.IGNORE_CASE
    )
    private val FAILED_RE = Regex(
        """\b(failed|declined|unsuccessful|could\s+not\s+be\s+completed|not\s+completed|cancelled|canceled|rejected|timed\s*out|expired|insufficient\s+funds|reversed|refunded|refund\s+initiated)\b""",
        RegexOption.IGNORE_CASE
    )
    private val PENDING_RE = Regex(
        """\b(pending|processing|in\s+progress|awaiting\s+bank|under\s+process|queued)\b""",
        RegexOption.IGNORE_CASE
    )
    private val INCOMING_RE = Regex(
        """\b(received\s+(?:₹|rs\.?|inr|from|a\s+payment)|credited\s+(?:with|to|by)|sent\s+you|paid\s+you|you\s+received|money\s+received|cashback\s+received|refund\s+credited)\b""",
        RegexOption.IGNORE_CASE
    )
    private val OUTGOING_RE = Regex(
        """\b(paid\s+(?:₹|rs\.?|inr|to)|you\s+paid|sent\s+(?:₹|rs\.?|inr)|debited\s+(?:by|for|with|from)|payment\s+of\s+(?:₹|rs\.?|inr)|transferred\s+(?:₹|rs\.?|inr)|spent\s+(?:₹|rs\.?|inr)|money\s+sent|upi\s+payment\s+successful|payment\s+successful)\b""",
        RegexOption.IGNORE_CASE
    )
    private val FOREIGN_CURRENCY_RE = Regex("""(?:^|\s)(\$|€|£|USD|EUR|GBP|AED|SGD)\s*\d""", RegexOption.IGNORE_CASE)
    private val INR_AMOUNT_RE = Regex("""(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)""", RegexOption.IGNORE_CASE)
    private val UTR_RE = Regex("""\b(?:UTR(?:\s*(?:No\.?|Number|ID))?|UPI\s*Ref(?:\s*(?:No\.?|Number|ID))?|Ref(?:\s*(?:No\.?|Number|ID))?)\s*[:#-]?\s*([A-Z0-9]{10,24})\b""", RegexOption.IGNORE_CASE)
    private val RRN_RE = Regex("""\b(?:RRN(?:\s*(?:No\.?|Number|ID))?)\s*[:#-]?\s*([A-Z0-9]{10,20})\b""", RegexOption.IGNORE_CASE)
    private val TXN_ID_RE = Regex("""\b(?:UPI\s*(?:Txn|Transaction)\s*ID|Txn\s*ID|Transaction\s*ID|Order\s*ID)\s*[:#-]?\s*([A-Z0-9_-]{8,36})\b""", RegexOption.IGNORE_CASE)
    private val VPA_RE = Regex("""\b([a-zA-Z0-9._-]{2,64}@(?:okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|paytm|upi|apl|fbl|icici|hdfcbank|sbi|kotak|indus|federal)[a-zA-Z0-9]*)\b""", RegexOption.IGNORE_CASE)

    fun parsePipeline(
        parserName: String,
        input: RawUpiNotification,
        app: SupportedUpiApp,
        merchantExtractor: ((String, String) -> String?)? = null
    ): UpiParseOutcome {
        val title = input.title.trim()
        val body = listOfNotNull(input.text.trim(), input.bigText?.trim(), input.subText?.trim())
            .filter { it.isNotEmpty() }
            .joinToString(" ")
            .replace(Regex("""\s+"""), " ")
        val combined = "$title $body".trim()

        if (combined.isEmpty()) {
            return UpiParseOutcome(false, "empty_notification", parserName)
        }
        if (SENSITIVE_OR_NON_PAYMENT.containsMatchIn(combined)) {
            return UpiParseOutcome(false, "sensitive_or_non_payment_notification", parserName)
        }
        if (INCOMING_RE.containsMatchIn(combined)) {
            return UpiParseOutcome(false, "incoming_transfer_ignored", parserName)
        }
        if (FAILED_RE.containsMatchIn(combined)) {
            return UpiParseOutcome(false, "failed_or_reversed_payment", parserName)
        }
        if (PENDING_RE.containsMatchIn(combined)) {
            return UpiParseOutcome(false, "pending_payment_not_final", parserName)
        }
        if (FOREIGN_CURRENCY_RE.containsMatchIn(combined) && !Regex("""(?:₹|\bRs\.?|\bINR\b)""", RegexOption.IGNORE_CASE).containsMatchIn(combined)) {
            return UpiParseOutcome(false, "missing_or_unsupported_amount", parserName)
        }
        if (!OUTGOING_RE.containsMatchIn(combined)) {
            return UpiParseOutcome(false, "not_outgoing_payment", parserName)
        }

        val amountPaise = extractInrPaise(combined)
            ?: return UpiParseOutcome(false, "missing_or_unsupported_amount", parserName)

        val merchantName = cleanMerchant(merchantExtractor?.invoke(title, body))
            ?: extractGenericMerchant(title, body)
        val upiId = VPA_RE.find(combined)?.groupValues?.getOrNull(1)?.lowercase()
        val utr = UTR_RE.find(combined)?.groupValues?.getOrNull(1)?.trim()
        val rrn = RRN_RE.find(combined)?.groupValues?.getOrNull(1)?.trim()
        val txnId = TXN_ID_RE.find(combined)?.groupValues?.getOrNull(1)?.trim()

        val hash = UpiNotificationParserRegistry.sha256Hex(
            "${input.packageName.lowercase()}|$title|${input.text}|${input.bigText.orEmpty()}"
        )

        var confidence = 0.60
        if (merchantName != null) confidence += 0.15
        if (txnId != null || utr != null || rrn != null) confidence += 0.20
        if (upiId != null) confidence += 0.05
        confidence = confidence.coerceAtMost(1.0)

        val verificationStatus = when {
            txnId != null || utr != null || rrn != null -> "verified"
            merchantName != null -> "partial"
            else -> "unverified"
        }

        val tx = DetectedUpiTransaction(
            id = "upi_det_${hash.take(12)}_${input.notificationTimestampMs.toString(36)}",
            amountPaise = amountPaise,
            sourceApp = app.name,
            sourceAppId = app.id,
            sourcePackage = input.packageName.trim(),
            merchantName = merchantName,
            upiId = upiId,
            upiTransactionId = txnId,
            utrNumber = utr,
            rrn = rrn,
            transactionTimestampMs = input.notificationTimestampMs,
            notificationTimestampMs = input.notificationTimestampMs,
            rawDataHash = hash,
            detectionConfidence = confidence,
            verificationStatus = verificationStatus,
            parserVersion = UpiNotificationParserRegistry.PARSER_VERSION,
            parserUsed = parserName
        )

        return UpiParseOutcome(
            accepted = true,
            parserUsed = parserName,
            transaction = tx
        )
    }

    private fun extractInrPaise(text: String): Long? {
        if (FOREIGN_CURRENCY_RE.containsMatchIn(text) && !Regex("""(?:₹|\bRs\.?|\bINR\b)""", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
            return null
        }
        val match = INR_AMOUNT_RE.find(text) ?: return null
        val cleaned = match.groupValues[1].replace(",", "").trim()
        val parts = cleaned.split(".")
        val rupees = parts[0].toLongOrNull() ?: return null
        val paise = if (parts.size > 1) parts[1].padEnd(2, '0').take(2).toLongOrNull() ?: 0L else 0L
        val total = rupees * 100L + paise
        return if (total in 1L..10_000_000_000L) total else null
    }

    private fun cleanMerchant(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val cleaned = raw
            .replace(Regex("""\s+(?:via|using|through|from|on|with)\s+(?:UPI|Google\s*Pay|GPay|PhonePe|Paytm|BHIM|Amazon\s*Pay|CRED|bank|account|a/c).*$""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""\s+(?:UTR|RRN|Ref|Txn\s*ID|Transaction\s*ID|UPI\s*Ref|Order\s*ID).*$""", RegexOption.IGNORE_CASE), "")
            .trim(' ', '.', ',', ';', ':', '|', '/', '-')
            .replace(Regex("""\s+"""), " ")
        if (cleaned.length < 2 || cleaned.all { it.isDigit() }) return null
        if (Regex("""^(?:upi|inr|rs|paid|sent|payment|successful|completed|bank|account|your|you)$""", RegexOption.IGNORE_CASE).matches(cleaned)) {
            return null
        }
        return cleaned.take(80)
    }

    private fun extractGenericMerchant(title: String, body: String): String? {
        val combined = "$title $body".replace(Regex("""\s+"""), " ")
        val patterns = listOf(
            Regex("""\b(?:paid|sent|transferred)\s+(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]{1,2})?\s+to\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:via|using|on|from|UTR|RRN|Ref|Txn|Transaction|UPI|successfully|\.)|\.|,|$)""", RegexOption.IGNORE_CASE),
            Regex("""\bto\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:via|using|through|on|UTR|RRN|Ref|Txn|Transaction|UPI|successful|completed|\.)|\.|,|$)""", RegexOption.IGNORE_CASE)
        )
        for (p in patterns) {
            val found = cleanMerchant(p.find(combined)?.groupValues?.getOrNull(1))
            if (found != null) return found
        }
        return null
    }

    fun isDuplicate(incoming: DetectedUpiTransaction, existing: List<DetectedUpiTransaction>): Boolean {
        for (item in existing) {
            if (!incoming.upiTransactionId.isNullOrBlank() && !item.upiTransactionId.isNullOrBlank()) {
                if (incoming.upiTransactionId.equals(item.upiTransactionId, ignoreCase = true)) return true
                continue
            }
            if (!incoming.utrNumber.isNullOrBlank() && !item.utrNumber.isNullOrBlank()) {
                if (incoming.utrNumber.equals(item.utrNumber, ignoreCase = true)) return true
                continue
            }
            if (!incoming.rrn.isNullOrBlank() && !item.rrn.isNullOrBlank()) {
                if (incoming.rrn.equals(item.rrn, ignoreCase = true)) return true
                continue
            }
            val diffMs = abs(incoming.notificationTimestampMs - item.notificationTimestampMs)
            if (incoming.rawDataHash == item.rawDataHash && diffMs <= 120_000L) return true
            if (diffMs <= 15_000L &&
                incoming.sourcePackage == item.sourcePackage &&
                incoming.amountPaise == item.amountPaise &&
                incoming.merchantName.orEmpty().lowercase() == item.merchantName.orEmpty().lowercase()
            ) {
                return true
            }
        }
        return false
    }
}

class GooglePayNotificationParser : UpiNotificationParser {
    override val parserName = "GooglePayNotificationParser"
    override fun parse(input: RawUpiNotification, app: SupportedUpiApp) =
        BaseUpiParsingCore.parsePipeline(parserName, input, app) { title, body ->
            Regex("""\b(?:you\s+)?paid\s+([A-Za-z0-9 &'.()_-]{2,50}?)\s+(?:₹|Rs\.?|INR)""", RegexOption.IGNORE_CASE)
                .find("$title $body")?.groupValues?.getOrNull(1)
        }
}

class PhonePeNotificationParser : UpiNotificationParser {
    override val parserName = "PhonePeNotificationParser"
    override fun parse(input: RawUpiNotification, app: SupportedUpiApp) =
        BaseUpiParsingCore.parsePipeline(parserName, input, app)
}

class PaytmNotificationParser : UpiNotificationParser {
    override val parserName = "PaytmNotificationParser"
    override fun parse(input: RawUpiNotification, app: SupportedUpiApp) =
        BaseUpiParsingCore.parsePipeline(parserName, input, app)
}

class BHIMNotificationParser : UpiNotificationParser {
    override val parserName = "BHIMNotificationParser"
    override fun parse(input: RawUpiNotification, app: SupportedUpiApp) =
        BaseUpiParsingCore.parsePipeline(parserName, input, app) { title, body ->
            Regex("""\b(?:debited\s+for|paid\s+to|transferred\s+to)\s+([A-Za-z0-9 &'.()_-]{2,60}?)(?:\s+(?:via|using|RRN|UTR|Ref|Txn|UPI|\.)|$)""", RegexOption.IGNORE_CASE)
                .find("$title $body")?.groupValues?.getOrNull(1)
        }
}

class GenericUpiNotificationParser : UpiNotificationParser {
    override val parserName = "GenericUpiNotificationParser"
    override fun parse(input: RawUpiNotification, app: SupportedUpiApp) =
        BaseUpiParsingCore.parsePipeline(parserName, input, app)
}
