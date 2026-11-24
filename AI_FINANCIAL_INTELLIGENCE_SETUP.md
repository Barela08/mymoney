# My Money Manager — AI Financial Intelligence Setup & Operations Guide

This guide covers the **7 AI Financial Intelligence features** integrated into **My Money Manager by HackifyPro**:

1. AI Money Assistant (`/ai-assistant`)
2. Smart Transaction Categorization (embedded in Add Transaction & Receipt Scanner)
3. Expense Calendar (`/expense-calendar`)
4. Smart Financial Alerts (`/smart-alerts`)
5. Receipt Scanner with OCR (`/receipt-scanner`)
6. Net Worth Tracker (`/net-worth`)
7. Safe-to-Spend Calculator (`/safe-to-spend`)

---

## 1. Zero-Cost & Deterministic-First Architecture

The platform is engineered to remain fully functional **without any paid AI or OCR subscription**:

| Capability | Deterministic / Free Local Behavior | Optional Server AI Enhancement |
|---|---|---|
| **Smart Categorization** | Exact merchant mapping, user-defined learned rules, historical patterns, and keyword rules (runs locally at ₹0 cost). | Optional `/api/ai/categorization/predict` fallback only when deterministic confidence is low. |
| **Expense Calendar** | 100% deterministic IST daily/weekly/monthly aggregation and Recharts visuals. | Not required. |
| **Smart Financial Alerts** | 100% deterministic budget thresholds, spending anomaly detection, bill reminders, savings milestones, Udhar alerts, deduplication, and quiet hours. | Not required. |
| **Net Worth Tracker** | 100% deterministic integer-paise `Assets - Liabilities` accounting, double-counting guards, and real persisted snapshots. | Not required. |
| **Safe-to-Spend Calculator** | 100% deterministic integer-paise discretionary pool calculation across Daily/Weekly/Monthly periods. | Not required. |
| **Receipt Scanner** | File validation (MIME + size + binary magic bytes), SHA-256 duplicate detection, and structured manual review form work with ₹0 external cost. | Automated image-to-fields Vision OCR via server-side Gemini (`GEMINI_API_KEY`). |
| **AI Money Assistant** | Financial snapshot aggregator computes every total deterministically on real user records. | Conversational explanation via server-side Gemini (`GEMINI_API_KEY`). |

When `GEMINI_API_KEY` is not configured, the server honestly reports `configured: false` on `GET /api/ai/status` and returns HTTP `503 AI_PROVIDER_NOT_CONFIGURED` on live AI/OCR calls — **no fake AI answers or fabricated OCR extractions are ever returned**.

---

## 2. Environment Variables

Add to your server `.env` (never expose in `VITE_*` client variables):

```env
# Optional: Enables live AI Money Assistant chat, AI categorization fallback, and Vision Receipt OCR
GEMINI_API_KEY=
```

All existing Supabase / PostgreSQL / SMTP / VAPID variables in `.env.example` remain untouched.

### Free / Local Provider Alternatives
- **Gemini API Free Tier**: Google AI Studio offers a free-tier API key suitable for personal/development usage (subject to Google rate limits).
- **Local / Self-Hosted Future Swap**: All AI calls are isolated inside `server/aiProvider.ts`. To swap to a self-hosted Ollama / vLLM / Tesseract OCR backend later, update only `server/aiProvider.ts` without modifying frontend components or API contracts.

---

## 3. Database Migration & Rollback Instructions

### Apply Migration (Non-Destructive, Idempotent)
Option A — Run the TypeScript migration script against your configured `DATABASE_URL`:
```bash
npx tsx scripts/migrate-ai-finance-schema.ts
```

Option B — Run the SQL migration directly in Supabase SQL Editor or `psql`:
```sql
-- Execute: scripts/migrations/20261123_ai_financial_intelligence.sql
```

This creates 11 isolated tables (`ai_conversations`, `ai_messages`, `user_categorization_rules`, `receipt_records`, `net_worth_assets`, `net_worth_liabilities`, `net_worth_settings`, `net_worth_snapshots`, `safe_to_spend_preferences`, `smart_alert_preferences`, `smart_alert_events`) with `CHECK` constraints, indexes, and strict `auth.uid()::text = user_id` Row Level Security (RLS) policies (also appended to `RLS_POLICIES.sql`).

### Rollback (Safe, Preserves All Core Data)
To remove only the new AI Financial Intelligence tables without touching any existing user, transaction, budget, recurring bill, savings goal, or Udhar records:
```sql
-- Execute: scripts/migrations/20261123_ai_financial_intelligence_rollback.sql
```
