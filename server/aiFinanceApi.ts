import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { authenticateRequest } from './auth.js';
import { query, isDatabaseAvailable } from './db.js';
import { logSecurityEvent, extractClientIp } from './security.js';
import { hasServerUserConsent } from './privacyConsentApi.js';
import { processSecureUpload } from './uploadSecurity.js';
import {
  getAiProviderStatus,
  askFinancialAssistant,
  classifyTransactionWithAi,
  extractReceiptWithOcr,
  AiProviderError,
} from './aiProvider.js';
import {
  categorizeTransactionDeterministic,
  upsertUserCategorizationRule,
  validateReceiptUpload,
  validateReceiptFileSignature,
  DEFAULT_SAFE_TO_SPEND_PREFS,
  DEFAULT_SMART_ALERT_PREFS,
  type UserCategorizationRule,
  type NetWorthAsset,
  type NetWorthLiability,
  type NetWorthSnapshot,
  type NetWorthSettings,
  type SafeToSpendPreferences,
  type SmartAlertPreferences,
  type SmartAlertEventState,
  type AiFinancialContextSnapshot,
} from '../src/lib/financialIntelligenceEngine.js';

// ============================================================================
// SERVER-SIDE RATE LIMITER & USER-SCOPED FALLBACK STORE
// ============================================================================

const aiRateWindow = new Map<string, { count: number; resetAt: number }>();

function checkAiRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = aiRateWindow.get(key);
  if (!entry || now > entry.resetAt) {
    aiRateWindow.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count += 1;
  return true;
}

interface StoredConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
}

interface StoredReceiptRecord {
  id: string;
  user_id: string;
  transaction_id?: string | null;
  file_hash: string;
  merchant: string;
  amount: number;
  receipt_date: string;
  receipt_number?: string;
  payment_method?: string;
  confidence?: number;
  created_at: string;
}

interface UserAiFinanceStore {
  conversations: StoredConversation[];
  categorizationRules: UserCategorizationRule[];
  netWorthAssets: NetWorthAsset[];
  netWorthLiabilities: NetWorthLiability[];
  netWorthSnapshots: NetWorthSnapshot[];
  netWorthSettings: NetWorthSettings;
  safeToSpendPrefs: SafeToSpendPreferences;
  smartAlertPrefs: SmartAlertPreferences;
  smartAlertState: SmartAlertEventState;
  receiptRecords: StoredReceiptRecord[];
}

function defaultUserStore(): UserAiFinanceStore {
  return {
    conversations: [],
    categorizationRules: [],
    netWorthAssets: [],
    netWorthLiabilities: [],
    netWorthSnapshots: [],
    netWorthSettings: {
      includeLiquidBalance: true,
      includeUdharReceivables: true,
      includeUdharPayables: true,
    },
    safeToSpendPrefs: { ...DEFAULT_SAFE_TO_SPEND_PREFS },
    smartAlertPrefs: { ...DEFAULT_SMART_ALERT_PREFS },
    smartAlertState: { readKeys: [], dismissedKeys: [] },
    receiptRecords: [],
  };
}

const DATA_DIR = path.resolve(process.cwd(), '.data', 'ai-finance');

function safeUserFilePath(userId: string): string {
  const hash = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32);
  const resolved = path.resolve(DATA_DIR, `u_${hash}.json`);
  if (!resolved.startsWith(DATA_DIR + path.sep)) {
    throw new Error('PATH_CONFINEMENT_VIOLATION');
  }
  return resolved;
}

function readUserStore(userId: string): UserAiFinanceStore {
  try {
    const filePath = safeUserFilePath(userId);
    if (!fs.existsSync(filePath)) return defaultUserStore();
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultUserStore(),
      ...parsed,
      netWorthSettings: {
        ...defaultUserStore().netWorthSettings,
        ...(parsed.netWorthSettings || {}),
      },
      safeToSpendPrefs: {
        ...DEFAULT_SAFE_TO_SPEND_PREFS,
        ...(parsed.safeToSpendPrefs || {}),
      },
      smartAlertPrefs: {
        ...DEFAULT_SMART_ALERT_PREFS,
        ...(parsed.smartAlertPrefs || {}),
      },
      smartAlertState: {
        readKeys: Array.isArray(parsed.smartAlertState?.readKeys) ? parsed.smartAlertState.readKeys : [],
        dismissedKeys: Array.isArray(parsed.smartAlertState?.dismissedKeys) ? parsed.smartAlertState.dismissedKeys : [],
      },
    };
  } catch {
    return defaultUserStore();
  }
}

function writeUserStore(userId: string, store: UserAiFinanceStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const filePath = safeUserFilePath(userId);
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[AI Finance Store] Persistence warning:', (err as Error)?.message);
  }
}

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req: IncomingMessage, maxBytes: number = 8 * 1024 * 1024): Promise<any> {
  const preParsed = (req as any).body;
  if (preParsed !== undefined && preParsed !== null) {
    if (typeof preParsed === 'object') return preParsed;
    if (typeof preParsed === 'string') {
      try {
        return JSON.parse(preParsed);
      } catch {
        return {};
      }
    }
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// MAIN ROUTER FOR /api/ai/* AND /api/finance/*
// ============================================================================

export async function handleAiFinanceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string
): Promise<boolean> {
  if (!pathname.startsWith('/api/ai/') && !pathname.startsWith('/api/finance/')) {
    return false;
  }

  // Public provider status (no secrets exposed)
  if (pathname === '/api/ai/status' && method === 'GET') {
    sendJson(res, 200, { success: true, status: await getAiProviderStatus() });
    return true;
  }

  // Every other AI & Finance endpoint strictly requires authentication
  const authUser = await authenticateRequest(req);
  if (!authUser) {
    sendJson(res, 401, { success: false, message: 'Authentication required.' });
    return true;
  }

  const userId = authUser.id;
  const useDb = isDatabaseAvailable();

  try {
    // ------------------------------------------------------------------------
    // FEATURE 1: AI MONEY ASSISTANT CONVERSATIONS & CHAT
    // ------------------------------------------------------------------------

    if (pathname === '/api/ai/conversations' && method === 'GET') {
      if (useDb) {
        try {
          const convs = await query(
            `SELECT id, title, created_at, updated_at FROM public.ai_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
            [userId]
          );
          const msgs = await query(
            `SELECT id, conversation_id, role, content, created_at FROM public.ai_messages WHERE user_id = $1 ORDER BY created_at ASC`,
            [userId]
          );
          const byConv = new Map<string, any[]>();
          for (const m of msgs.rows) {
            const arr = byConv.get(m.conversation_id) || [];
            arr.push(m);
            byConv.set(m.conversation_id, arr);
          }
          const conversations = convs.rows.map((c: any) => ({
            ...c,
            messages: byConv.get(c.id) || [],
          }));
          sendJson(res, 200, { success: true, conversations, status: await getAiProviderStatus() });
          return true;
        } catch {
          // Table may not be migrated yet; fall back cleanly to server user store
        }
      }
      const store = readUserStore(userId);
      sendJson(res, 200, {
        success: true,
        conversations: store.conversations.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        status: await getAiProviderStatus(),
      });
      return true;
    }

    if (pathname === '/api/ai/conversations' && method === 'POST') {
      const body = await parseJsonBody(req);
      const title = String(body.title || 'New Financial Chat').trim().slice(0, 120) || 'New Financial Chat';
      const now = new Date().toISOString();
      const conv: StoredConversation = {
        id: `conv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        user_id: userId,
        title,
        created_at: now,
        updated_at: now,
        messages: [],
      };
      if (useDb) {
        try {
          await query(
            `INSERT INTO public.ai_conversations (id, user_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
            [conv.id, userId, conv.title, now]
          );
          sendJson(res, 201, { success: true, conversation: conv });
          return true;
        } catch {
          // fallback
        }
      }
      const store = readUserStore(userId);
      store.conversations.unshift(conv);
      store.conversations = store.conversations.slice(0, 50);
      writeUserStore(userId, store);
      sendJson(res, 201, { success: true, conversation: conv });
      return true;
    }

    if (pathname === '/api/ai/conversations' && method === 'DELETE') {
      if (useDb) {
        try {
          await query(`DELETE FROM public.ai_messages WHERE user_id = $1`, [userId]);
          await query(`DELETE FROM public.ai_conversations WHERE user_id = $1`, [userId]);
        } catch {
          // fallback
        }
      }
      const store = readUserStore(userId);
      store.conversations = [];
      writeUserStore(userId, store);
      if (useDb) {
        logSecurityEvent('AI_HISTORY_CLEARED', {
          userId,
          userEmail: authUser.email,
          actorRole: authUser.role,
          details: { scope: 'all_conversations' },
        }).catch(() => {});
      }
      sendJson(res, 200, { success: true, message: 'All conversations cleared.' });
      return true;
    }

    const convIdMatch = pathname.match(/^\/api\/ai\/conversations\/([a-zA-Z0-9_-]+)$/);
    if (convIdMatch && method === 'PATCH') {
      const convId = convIdMatch[1];
      const body = await parseJsonBody(req);
      const newTitle = String(body.title || '').trim().slice(0, 120);
      if (!newTitle) {
        sendJson(res, 400, { success: false, message: 'Conversation title is required.' });
        return true;
      }
      const now = new Date().toISOString();
      if (useDb) {
        try {
          await query(
            `UPDATE public.ai_conversations SET title = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
            [newTitle, now, convId, userId]
          );
        } catch {
          // fallback
        }
      }
      const store = readUserStore(userId);
      const target = store.conversations.find((c) => c.id === convId && c.user_id === userId);
      if (target) {
        target.title = newTitle;
        target.updated_at = now;
        writeUserStore(userId, store);
      }
      sendJson(res, 200, { success: true, title: newTitle });
      return true;
    }

    if (convIdMatch && method === 'DELETE') {
      const convId = convIdMatch[1];
      if (useDb) {
        try {
          await query(`DELETE FROM public.ai_messages WHERE conversation_id = $1 AND user_id = $2`, [convId, userId]);
          await query(`DELETE FROM public.ai_conversations WHERE id = $1 AND user_id = $2`, [convId, userId]);
        } catch {
          // fallback
        }
      }
      const store = readUserStore(userId);
      store.conversations = store.conversations.filter((c) => !(c.id === convId && c.user_id === userId));
      writeUserStore(userId, store);
      sendJson(res, 200, { success: true, message: 'Conversation deleted.' });
      return true;
    }

    if (pathname === '/api/ai/assistant/chat' && method === 'POST') {
      const hasAiConsent = await hasServerUserConsent(authUser, 'ai_processing');
      if (!hasAiConsent) {
        sendJson(res, 403, {
          success: false,
          code: 'AI_CONSENT_REQUIRED',
          message:
            'AI External Processing consent is currently off. Enable it under Settings → Privacy → Manage Consent to send questions to the external AI provider.',
        });
        return true;
      }

      if (!checkAiRateLimit(`chat:${userId}`, 25, 60 * 1000)) {
        if (useDb) {
          logSecurityEvent('AI_RATE_LIMITED', {
            userId,
            userEmail: authUser.email,
            actorRole: authUser.role,
            details: { endpoint: '/api/ai/assistant/chat' },
          }).catch(() => {});
        }
        sendJson(res, 429, {
          success: false,
          code: 'RATE_LIMITED',
          message: 'Too many AI questions in a short time. Please wait a minute and try again.',
        });
        return true;
      }

      const body = await parseJsonBody(req);
      const question = String(body.question || '').trim();
      if (!question || question.length > 1500) {
        sendJson(res, 400, { success: false, message: 'Please enter a question between 1 and 1500 characters.' });
        return true;
      }

      const safeStr = (val: unknown, maxLen = 80): string =>
        String(val ?? '')
          .replace(/[\x00-\x1F\x7F<>]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, maxLen);
      const safeNum = (val: unknown): number => {
        const n = Number(val);
        if (!Number.isFinite(n)) return 0;
        return Math.max(-9999999999, Math.min(9999999999, Math.round(n * 100) / 100));
      };
      const rawCtx = body.financialContext && typeof body.financialContext === 'object' ? body.financialContext : {};
      const rawTotals = rawCtx.totals && typeof rawCtx.totals === 'object' ? rawCtx.totals : {};
      const rawUdhar = rawCtx.udharSummary && typeof rawCtx.udharSummary === 'object' ? rawCtx.udharSummary : {};

      const contextSnapshot: AiFinancialContextSnapshot = {
        asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(String(rawCtx.asOfDate || '')) ? String(rawCtx.asOfDate) : new Date().toISOString().slice(0, 10),
        currency: 'INR',
        totals: {
          allTimeIncome: safeNum(rawTotals.allTimeIncome),
          allTimeExpenses: safeNum(rawTotals.allTimeExpenses),
          allTimeBorrowed: safeNum(rawTotals.allTimeBorrowed),
          availableBalance: safeNum(rawTotals.availableBalance),
          thisMonthIncome: safeNum(rawTotals.thisMonthIncome),
          thisMonthExpenses: safeNum(rawTotals.thisMonthExpenses),
          lastMonthIncome: safeNum(rawTotals.lastMonthIncome),
          lastMonthExpenses: safeNum(rawTotals.lastMonthExpenses),
          thisMonthNetFlow: safeNum(rawTotals.thisMonthNetFlow),
          monthOverMonthExpenseDelta: safeNum(rawTotals.monthOverMonthExpenseDelta),
          monthOverMonthExpensePercent:
            rawTotals.monthOverMonthExpensePercent === null || rawTotals.monthOverMonthExpensePercent === undefined
              ? null
              : safeNum(rawTotals.monthOverMonthExpensePercent),
          totalTransactionCount: Math.max(0, Math.min(1000000, Math.round(safeNum(rawTotals.totalTransactionCount)))),
        },
        topExpenseCategoriesThisMonth: Array.isArray(rawCtx.topExpenseCategoriesThisMonth)
          ? rawCtx.topExpenseCategoriesThisMonth.slice(0, 15).map((c: any) => ({
              category: safeStr(c?.category, 50),
              amount: safeNum(c?.amount),
              sharePercent: safeNum(c?.sharePercent),
            }))
          : [],
        topExpenseCategoriesAllTime: Array.isArray(rawCtx.topExpenseCategoriesAllTime)
          ? rawCtx.topExpenseCategoriesAllTime.slice(0, 15).map((c: any) => ({
              category: safeStr(c?.category, 50),
              amount: safeNum(c?.amount),
              sharePercent: safeNum(c?.sharePercent),
            }))
          : [],
        biggestExpenseThisMonth:
          rawCtx.biggestExpenseThisMonth && typeof rawCtx.biggestExpenseThisMonth === 'object'
            ? {
                title: safeStr(rawCtx.biggestExpenseThisMonth.title, 80),
                amount: safeNum(rawCtx.biggestExpenseThisMonth.amount),
                date: safeStr(rawCtx.biggestExpenseThisMonth.date, 20),
                category: safeStr(rawCtx.biggestExpenseThisMonth.category, 50),
              }
            : null,
        monthlyTrendLast6Months: Array.isArray(rawCtx.monthlyTrendLast6Months)
          ? rawCtx.monthlyTrendLast6Months.slice(0, 12).map((m: any) => ({
              month: safeStr(m?.month, 20),
              income: safeNum(m?.income),
              expenses: safeNum(m?.expenses),
            }))
          : [],
        budgets: Array.isArray(rawCtx.budgets)
          ? rawCtx.budgets.slice(0, 30).map((b: any) => ({
              category: safeStr(b?.category, 50),
              limit: safeNum(b?.limit),
              spent: safeNum(b?.spent),
              percentUsed: safeNum(b?.percentUsed),
            }))
          : [],
        upcomingBills: Array.isArray(rawCtx.upcomingBills)
          ? rawCtx.upcomingBills.slice(0, 30).map((b: any) => ({
              title: safeStr(b?.title, 80),
              amount: safeNum(b?.amount),
              dueDay: Math.max(1, Math.min(31, Math.round(safeNum(b?.dueDay)) || 1)),
            }))
          : [],
        savingsGoals: Array.isArray(rawCtx.savingsGoals)
          ? rawCtx.savingsGoals.slice(0, 30).map((g: any) => ({
              title: safeStr(g?.title, 80),
              current: safeNum(g?.current),
              target: safeNum(g?.target),
            }))
          : [],
        udharSummary: {
          totalReceivable: safeNum(rawUdhar.totalReceivable),
          totalPayable: safeNum(rawUdhar.totalPayable),
          netUdharBalance: safeNum(rawUdhar.netUdharBalance),
          activePeopleCount: Math.max(0, Math.min(10000, Math.round(safeNum(rawUdhar.activePeopleCount)))),
        },
        recentTransactions: Array.isArray(rawCtx.recentTransactions)
          ? rawCtx.recentTransactions.slice(0, 40).map((t: any) => ({
              title: safeStr(t?.title, 80),
              amount: safeNum(t?.amount),
              type: t?.type === 'income' ? 'income' : 'expense',
              category: safeStr(t?.category, 50),
              date: safeStr(t?.date, 20),
            }))
          : [],
      };

      const store = readUserStore(userId);
      let convId = String(body.conversationId || '').trim();
      let conv = store.conversations.find((c) => c.id === convId && c.user_id === userId);
      const now = new Date().toISOString();

      if (!conv) {
        conv = {
          id: convId || `conv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          user_id: userId,
          title: question.slice(0, 64),
          created_at: now,
          updated_at: now,
          messages: [],
        };
        store.conversations.unshift(conv);
        convId = conv.id;
      }

      const history = conv.messages.map((m) => ({ role: m.role, content: m.content }));

      const mode = body.mode === 'voice' ? 'voice' : 'chat';

      try {
        const result = await askFinancialAssistant({
          question,
          history,
          context: contextSnapshot,
          userName: authUser.full_name,
          mode,
        });

        const userMsg = {
          id: `msg_u_${Date.now()}`,
          role: 'user' as const,
          content: question,
          created_at: now,
        };
        const aiMsg = {
          id: `msg_a_${Date.now() + 1}`,
          role: 'assistant' as const,
          content: result.answer,
          created_at: new Date().toISOString(),
        };

        if (conv.messages.length === 0 && (conv.title === 'New Financial Chat' || !conv.title)) {
          conv.title = question.slice(0, 64);
        }
        conv.messages.push(userMsg, aiMsg);
        conv.updated_at = aiMsg.created_at;
        writeUserStore(userId, store);

        if (useDb) {
          try {
            await query(
              `INSERT INTO public.ai_conversations (id, user_id, title, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at`,
              [conv.id, userId, conv.title, conv.created_at, conv.updated_at]
            );
            await query(
              `INSERT INTO public.ai_messages (id, conversation_id, user_id, role, content, created_at)
               VALUES ($1, $2, $3, 'user', $4, $5), ($6, $2, $3, 'assistant', $7, $8)`,
              [userMsg.id, conv.id, userId, userMsg.content, userMsg.created_at, aiMsg.id, aiMsg.content, aiMsg.created_at]
            );
          } catch {
            // fallback already saved
          }
        }

        sendJson(res, 200, {
          success: true,
          conversationId: conv.id,
          conversationTitle: conv.title,
          userMessage: userMsg,
          assistantMessage: aiMsg,
          model: result.model,
        });
        return true;
      } catch (err: any) {
        if (err instanceof AiProviderError) {
          sendJson(res, err.statusCode, {
            success: false,
            code: err.code,
            message: err.message,
          });
          return true;
        }
        throw err;
      }
    }

    // ------------------------------------------------------------------------
    // FEATURE 2: SMART TRANSACTION CATEGORIZATION RULES & PREDICTION
    // ------------------------------------------------------------------------

    if (pathname === '/api/ai/categorization/rules' && method === 'GET') {
      const store = readUserStore(userId);
      sendJson(res, 200, { success: true, rules: store.categorizationRules });
      return true;
    }

    if (pathname === '/api/ai/categorization/rules' && method === 'POST') {
      const body = await parseJsonBody(req);
      const merchantPattern = String(body.merchant_pattern || '').trim();
      const category = body.category;
      const subcategory = String(body.subcategory || 'other_general');
      const txType = body.transaction_type === 'income' ? 'income' : 'expense';

      if (merchantPattern.length < 2 || !['home', 'room', 'food', 'other', 'people'].includes(category)) {
        sendJson(res, 400, { success: false, message: 'Valid merchant pattern and category are required.' });
        return true;
      }

      const store = readUserStore(userId);
      store.categorizationRules = upsertUserCategorizationRule(
        store.categorizationRules,
        merchantPattern,
        category,
        subcategory,
        txType
      );
      writeUserStore(userId, store);

      if (useDb) {
        const latest = store.categorizationRules.find(
          (r) => r.merchant_pattern === merchantPattern.toLowerCase().trim()
        );
        if (latest) {
          query(
            `INSERT INTO public.user_categorization_rules (id, user_id, merchant_pattern, category, subcategory, transaction_type, usage_count, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, merchant_pattern) DO UPDATE
             SET category = EXCLUDED.category, subcategory = EXCLUDED.subcategory, transaction_type = EXCLUDED.transaction_type, usage_count = EXCLUDED.usage_count, updated_at = EXCLUDED.updated_at`,
            [latest.id, userId, latest.merchant_pattern, latest.category, latest.subcategory, latest.transaction_type, latest.usage_count, latest.updated_at]
          ).catch(() => {});
        }
      }

      sendJson(res, 200, { success: true, rules: store.categorizationRules });
      return true;
    }

    const ruleDeleteMatch = pathname.match(/^\/api\/ai\/categorization\/rules\/([a-zA-Z0-9_-]+)$/);
    if (ruleDeleteMatch && method === 'DELETE') {
      const ruleId = ruleDeleteMatch[1];
      const store = readUserStore(userId);
      store.categorizationRules = store.categorizationRules.filter((r) => r.id !== ruleId);
      writeUserStore(userId, store);
      if (useDb) {
        query(`DELETE FROM public.user_categorization_rules WHERE id = $1 AND user_id = $2`, [ruleId, userId]).catch(() => {});
      }
      sendJson(res, 200, { success: true, rules: store.categorizationRules });
      return true;
    }

    if (pathname === '/api/ai/categorization/predict' && method === 'POST') {
      const body = await parseJsonBody(req);
      const store = readUserStore(userId);
      const det = categorizeTransactionDeterministic(
        {
          title: body.title,
          description: body.description,
          merchant: body.merchant,
          notes: body.notes,
          amount: body.amount,
        },
        store.categorizationRules
      );

      if (det && !det.needsAiFallback) {
        sendJson(res, 200, { success: true, suggestion: det });
        return true;
      }

      if (!(await getAiProviderStatus()).configured) {
        sendJson(res, 200, { success: true, suggestion: det, aiFallbackSkipped: true });
        return true;
      }

      // Never send financial records externally without explicit ai_processing consent;
      // fall back cleanly to local deterministic categorization.
      const hasAiConsent = await hasServerUserConsent(authUser, 'ai_processing');
      if (!hasAiConsent) {
        sendJson(res, 200, {
          success: true,
          suggestion: det,
          aiFallbackSkipped: true,
          aiConsentRequired: true,
        });
        return true;
      }

      if (!checkAiRateLimit(`cat:${userId}`, 40, 60 * 1000)) {
        sendJson(res, 200, { success: true, suggestion: det, rateLimited: true });
        return true;
      }

      try {
        const aiRes = await classifyTransactionWithAi({
          title: body.title,
          description: body.description,
          merchant: body.merchant,
          amount: body.amount,
        });
        sendJson(res, 200, {
          success: true,
          suggestion: {
            ...aiRes,
            displayCategory: aiRes.subcategory.replace(/_/g, ' '),
            source: 'ai',
            needsAiFallback: false,
          },
        });
        return true;
      } catch {
        sendJson(res, 200, { success: true, suggestion: det, aiFallbackFailed: true });
        return true;
      }
    }

    // ------------------------------------------------------------------------
    // FEATURE 5: RECEIPT SCANNER OCR & RECEIPT DUPLICATE REGISTRY
    // ------------------------------------------------------------------------

    if (pathname === '/api/ai/receipt-ocr' && method === 'POST') {
      const hasAiConsent = await hasServerUserConsent(authUser, 'ai_processing');
      if (!hasAiConsent) {
        sendJson(res, 403, {
          success: false,
          code: 'AI_CONSENT_REQUIRED',
          message:
            'AI External Processing consent is currently off. Enable it under Settings → Privacy → Manage Consent to scan receipts with external AI OCR, or enter receipt details manually.',
        });
        return true;
      }

      if (!checkAiRateLimit(`ocr:${userId}`, 12, 60 * 1000)) {
        sendJson(res, 429, {
          success: false,
          code: 'RATE_LIMITED',
          message: 'Too many receipt scans in a minute. Please wait briefly and try again.',
        });
        return true;
      }

      const body = await parseJsonBody(req, 8 * 1024 * 1024);
      const dataUrl = String(body.imageDataUrl || '');
      const filename = String(body.filename || 'receipt.jpg').slice(0, 140);
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
      if (!match) {
        sendJson(res, 400, { success: false, message: 'Invalid receipt image data. Please upload a JPG, PNG, or WEBP image.' });
        return true;
      }

      const mimeType = match[1].toLowerCase();
      const rawBase64 = match[2].replace(/\s+/g, '');
      const estimatedBytes = Math.floor((rawBase64.length * 3) / 4);
      const validation = validateReceiptUpload(mimeType, estimatedBytes);
      if (!validation.valid) {
        sendJson(res, 400, { success: false, message: validation.error });
        return true;
      }

      // Security: quarantine-first validation (filename, magic bytes, dimension bomb, polyglot/EICAR, EXIF scrub, ClamAV)
      const sigValidation = validateReceiptFileSignature(rawBase64, mimeType);
      if (!sigValidation.valid) {
        if (useDb) {
          logSecurityEvent('RECEIPT_INVALID_SIGNATURE', {
            userId,
            userEmail: authUser.email,
            actorRole: authUser.role,
            details: { declaredMimeType: mimeType, estimatedBytes },
          }).catch(() => {});
        }
        sendJson(res, 400, { success: false, code: 'INVALID_FILE_SIGNATURE', message: sigValidation.error });
        return true;
      }

      const scanRes = await processSecureUpload({
        userId,
        userEmail: authUser.email,
        purpose: 'receipt_ocr',
        filename,
        dataUrlOrRawBase64: dataUrl,
        declaredMime: mimeType,
        ipAddress: extractClientIp(req),
        allowSvg: false,
      });

      if (!scanRes.success || !scanRes.cleanBytes || !scanRes.mimeType) {
        const statusCode = scanRes.status === 'quarantined_pending' ? 202 : 400;
        sendJson(res, statusCode, {
          success: false,
          code: scanRes.status === 'quarantined_pending' ? 'QUARANTINED_PENDING_REVIEW' : 'UPLOAD_SECURITY_REJECTED',
          quarantineId: scanRes.quarantineId,
          scanStatus: scanRes.status,
          scannerEngine: scanRes.scannerEngine,
          message: scanRes.error || 'Receipt image failed security validation.',
        });
        return true;
      }

      const cleanBase64 = scanRes.cleanBytes.toString('base64');
      const fileHash = scanRes.sha256 || crypto.createHash('sha256').update(cleanBase64).digest('hex');

      try {
        const extraction = await extractReceiptWithOcr({ base64Image: cleanBase64, mimeType: scanRes.mimeType });
        const store = readUserStore(userId);
        const categorization = categorizeTransactionDeterministic(
          {
            merchant: extraction.merchant,
            title: extraction.merchant,
            description: extraction.items.map((i) => i.name).join(', '),
            amount: extraction.totalAmount ?? undefined,
          },
          store.categorizationRules
        );

        sendJson(res, 200, {
          success: true,
          fileHash,
          quarantineId: scanRes.quarantineId,
          scanStatus: scanRes.status,
          scannerEngine: scanRes.scannerEngine,
          signedAccessUrl: scanRes.signedAccessUrl,
          extraction,
          categorization,
        });
        return true;
      } catch (err: any) {
        if (err instanceof AiProviderError) {
          sendJson(res, err.statusCode, {
            success: false,
            code: err.code,
            fileHash,
            message: err.message,
          });
          return true;
        }
        throw err;
      }
    }

    if (pathname === '/api/finance/receipts' && method === 'GET') {
      const store = readUserStore(userId);
      sendJson(res, 200, { success: true, receipts: store.receiptRecords });
      return true;
    }

    if (pathname === '/api/finance/receipts' && method === 'POST') {
      const body = await parseJsonBody(req);
      const store = readUserStore(userId);
      const record: StoredReceiptRecord = {
        id: `rcpt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        user_id: userId,
        transaction_id: body.transaction_id || null,
        file_hash: String(body.file_hash || ''),
        merchant: String(body.merchant || '').slice(0, 140),
        amount: Number(body.amount) || 0,
        receipt_date: String(body.receipt_date || '').slice(0, 10),
        receipt_number: String(body.receipt_number || '').slice(0, 80),
        payment_method: String(body.payment_method || '').slice(0, 40),
        confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
        created_at: new Date().toISOString(),
      };
      store.receiptRecords.unshift(record);
      store.receiptRecords = store.receiptRecords.slice(0, 500);
      writeUserStore(userId, store);
      if (useDb) {
        query(
          `INSERT INTO public.receipt_records (id, user_id, transaction_id, file_hash, merchant, amount, receipt_date, receipt_number, payment_method, confidence, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::date, $8, $9, $10, $11)`,
          [record.id, userId, record.transaction_id, record.file_hash, record.merchant, record.amount, record.receipt_date, record.receipt_number || null, record.payment_method || null, record.confidence ?? null, record.created_at]
        ).catch(() => {});
      }
      sendJson(res, 201, { success: true, receipt: record });
      return true;
    }

    // ------------------------------------------------------------------------
    // FEATURE 6: NET WORTH TRACKER CRUD & SNAPSHOTS
    // ------------------------------------------------------------------------

    if (pathname === '/api/finance/net-worth' && method === 'GET') {
      const store = readUserStore(userId);
      sendJson(res, 200, {
        success: true,
        assets: store.netWorthAssets,
        liabilities: store.netWorthLiabilities,
        snapshots: store.netWorthSnapshots,
        settings: store.netWorthSettings,
      });
      return true;
    }

    if (pathname === '/api/finance/net-worth/assets' && method === 'POST') {
      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim().slice(0, 100);
      const currentValue = Number(body.current_value);
      if (!name || !Number.isFinite(currentValue) || currentValue < 0) {
        sendJson(res, 400, { success: false, message: 'Asset name and valid non-negative value are required.' });
        return true;
      }
      const store = readUserStore(userId);
      const now = new Date().toISOString();
      const asset: NetWorthAsset = {
        id: body.id || `asset_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        name,
        category: body.category || 'other',
        current_value: Math.round(currentValue * 100) / 100,
        valuation_date: String(body.valuation_date || now.slice(0, 10)).slice(0, 10),
        notes: String(body.notes || '').trim().slice(0, 250) || undefined,
        is_archived: Boolean(body.is_archived),
        updated_at: now,
      };
      const idx = store.netWorthAssets.findIndex((a) => a.id === asset.id);
      if (idx >= 0) store.netWorthAssets[idx] = asset;
      else store.netWorthAssets.unshift(asset);
      writeUserStore(userId, store);
      if (useDb) {
        query(
          `INSERT INTO public.net_worth_assets (id, user_id, name, category, current_value, valuation_date, notes, is_archived, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, current_value = EXCLUDED.current_value, valuation_date = EXCLUDED.valuation_date, notes = EXCLUDED.notes, is_archived = EXCLUDED.is_archived, updated_at = EXCLUDED.updated_at`,
          [asset.id, userId, asset.name, asset.category, asset.current_value, asset.valuation_date, asset.notes || null, asset.is_archived, asset.updated_at]
        ).catch(() => {});
      }
      sendJson(res, 200, { success: true, asset, assets: store.netWorthAssets });
      return true;
    }

    const assetIdMatch = pathname.match(/^\/api\/finance\/net-worth\/assets\/([a-zA-Z0-9_-]+)$/);
    if (assetIdMatch && method === 'DELETE') {
      const id = assetIdMatch[1];
      const store = readUserStore(userId);
      store.netWorthAssets = store.netWorthAssets.filter((a) => a.id !== id);
      writeUserStore(userId, store);
      if (useDb) {
        query(`DELETE FROM public.net_worth_assets WHERE id = $1 AND user_id = $2`, [id, userId]).catch(() => {});
        logSecurityEvent('NET_WORTH_ITEM_DELETED', {
          userId,
          userEmail: authUser.email,
          actorRole: authUser.role,
          details: { type: 'asset', id },
        }).catch(() => {});
      }
      sendJson(res, 200, { success: true, assets: store.netWorthAssets });
      return true;
    }

    if (pathname === '/api/finance/net-worth/liabilities' && method === 'POST') {
      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim().slice(0, 100);
      const currentBalance = Number(body.current_balance);
      if (!name || !Number.isFinite(currentBalance) || currentBalance < 0) {
        sendJson(res, 400, { success: false, message: 'Liability name and valid non-negative balance are required.' });
        return true;
      }
      const store = readUserStore(userId);
      const now = new Date().toISOString();
      const liability: NetWorthLiability = {
        id: body.id || `liab_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        name,
        category: body.category || 'other',
        current_balance: Math.round(currentBalance * 100) / 100,
        valuation_date: String(body.valuation_date || now.slice(0, 10)).slice(0, 10),
        notes: String(body.notes || '').trim().slice(0, 250) || undefined,
        is_archived: Boolean(body.is_archived),
        updated_at: now,
      };
      const idx = store.netWorthLiabilities.findIndex((l) => l.id === liability.id);
      if (idx >= 0) store.netWorthLiabilities[idx] = liability;
      else store.netWorthLiabilities.unshift(liability);
      writeUserStore(userId, store);
      if (useDb) {
        query(
          `INSERT INTO public.net_worth_liabilities (id, user_id, name, category, current_balance, valuation_date, notes, is_archived, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, current_balance = EXCLUDED.current_balance, valuation_date = EXCLUDED.valuation_date, notes = EXCLUDED.notes, is_archived = EXCLUDED.is_archived, updated_at = EXCLUDED.updated_at`,
          [liability.id, userId, liability.name, liability.category, liability.current_balance, liability.valuation_date, liability.notes || null, liability.is_archived, liability.updated_at]
        ).catch(() => {});
      }
      sendJson(res, 200, { success: true, liability, liabilities: store.netWorthLiabilities });
      return true;
    }

    const liabIdMatch = pathname.match(/^\/api\/finance\/net-worth\/liabilities\/([a-zA-Z0-9_-]+)$/);
    if (liabIdMatch && method === 'DELETE') {
      const id = liabIdMatch[1];
      const store = readUserStore(userId);
      store.netWorthLiabilities = store.netWorthLiabilities.filter((l) => l.id !== id);
      writeUserStore(userId, store);
      if (useDb) {
        query(`DELETE FROM public.net_worth_liabilities WHERE id = $1 AND user_id = $2`, [id, userId]).catch(() => {});
        logSecurityEvent('NET_WORTH_ITEM_DELETED', {
          userId,
          userEmail: authUser.email,
          actorRole: authUser.role,
          details: { type: 'liability', id },
        }).catch(() => {});
      }
      sendJson(res, 200, { success: true, liabilities: store.netWorthLiabilities });
      return true;
    }

    if (pathname === '/api/finance/net-worth/snapshots' && method === 'POST') {
      const body = await parseJsonBody(req);
      const snapshotDate = String(body.snapshot_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const store = readUserStore(userId);
      const snap: NetWorthSnapshot = {
        id: `nw_snap_${snapshotDate}`,
        snapshot_date: snapshotDate,
        total_assets: Math.round((Number(body.total_assets) || 0) * 100) / 100,
        total_liabilities: Math.round((Number(body.total_liabilities) || 0) * 100) / 100,
        net_worth: Math.round((Number(body.net_worth) || 0) * 100) / 100,
        linked_liquid_balance: Math.round((Number(body.linked_liquid_balance) || 0) * 100) / 100,
        linked_udhar_receivable: Math.round((Number(body.linked_udhar_receivable) || 0) * 100) / 100,
        linked_udhar_payable: Math.round((Number(body.linked_udhar_payable) || 0) * 100) / 100,
      };
      store.netWorthSnapshots = [
        ...store.netWorthSnapshots.filter((s) => s.snapshot_date !== snapshotDate),
        snap,
      ].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
      writeUserStore(userId, store);
      if (useDb) {
        query(
          `INSERT INTO public.net_worth_snapshots (id, user_id, snapshot_date, total_assets, total_liabilities, net_worth, linked_liquid_balance, linked_udhar_receivable, linked_udhar_payable)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id, snapshot_date) DO UPDATE SET total_assets = EXCLUDED.total_assets, total_liabilities = EXCLUDED.total_liabilities, net_worth = EXCLUDED.net_worth, linked_liquid_balance = EXCLUDED.linked_liquid_balance, linked_udhar_receivable = EXCLUDED.linked_udhar_receivable, linked_udhar_payable = EXCLUDED.linked_udhar_payable`,
          [snap.id, userId, snap.snapshot_date, snap.total_assets, snap.total_liabilities, snap.net_worth, snap.linked_liquid_balance, snap.linked_udhar_receivable, snap.linked_udhar_payable]
        ).catch(() => {});
      }
      sendJson(res, 200, { success: true, snapshot: snap, snapshots: store.netWorthSnapshots });
      return true;
    }

    if (pathname === '/api/finance/net-worth/settings' && method === 'PUT') {
      const body = await parseJsonBody(req);
      const store = readUserStore(userId);
      store.netWorthSettings = {
        includeLiquidBalance:
          typeof body.includeLiquidBalance === 'boolean'
            ? body.includeLiquidBalance
            : store.netWorthSettings.includeLiquidBalance,
        includeUdharReceivables:
          typeof body.includeUdharReceivables === 'boolean'
            ? body.includeUdharReceivables
            : store.netWorthSettings.includeUdharReceivables,
        includeUdharPayables:
          typeof body.includeUdharPayables === 'boolean'
            ? body.includeUdharPayables
            : store.netWorthSettings.includeUdharPayables,
      };
      writeUserStore(userId, store);
      sendJson(res, 200, { success: true, settings: store.netWorthSettings });
      return true;
    }

    // ------------------------------------------------------------------------
    // FEATURE 7: SAFE-TO-SPEND PREFERENCES
    // ------------------------------------------------------------------------

    if (pathname === '/api/finance/safe-to-spend/preferences' && method === 'GET') {
      const store = readUserStore(userId);
      sendJson(res, 200, { success: true, preferences: store.safeToSpendPrefs });
      return true;
    }

    if (pathname === '/api/finance/safe-to-spend/preferences' && method === 'PUT') {
      const body = await parseJsonBody(req);
      const store = readUserStore(userId);
      const num = (v: any, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
      };
      store.safeToSpendPrefs = {
        minimumBalanceReserve: num(body.minimumBalanceReserve, store.safeToSpendPrefs.minimumBalanceReserve),
        emergencyReserve: num(body.emergencyReserve, store.safeToSpendPrefs.emergencyReserve),
        savingsCommitment: num(body.savingsCommitment, store.safeToSpendPrefs.savingsCommitment),
        essentialExpenseReserve: num(body.essentialExpenseReserve, store.safeToSpendPrefs.essentialExpenseReserve),
        expectedRemainingIncome: num(body.expectedRemainingIncome, store.safeToSpendPrefs.expectedRemainingIncome),
        includeExpectedIncome:
          typeof body.includeExpectedIncome === 'boolean'
            ? body.includeExpectedIncome
            : store.safeToSpendPrefs.includeExpectedIncome,
        period: body.period === 'day' ? 'day' : body.period === 'week' ? 'week' : 'month',
      };
      writeUserStore(userId, store);
      if (useDb) {
        query(
          `INSERT INTO public.safe_to_spend_preferences (user_id, minimum_balance_reserve, emergency_reserve, savings_commitment, essential_expense_reserve, expected_remaining_income, include_expected_income, period, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (user_id) DO UPDATE SET minimum_balance_reserve = EXCLUDED.minimum_balance_reserve, emergency_reserve = EXCLUDED.emergency_reserve, savings_commitment = EXCLUDED.savings_commitment, essential_expense_reserve = EXCLUDED.essential_expense_reserve, expected_remaining_income = EXCLUDED.expected_remaining_income, include_expected_income = EXCLUDED.include_expected_income, period = EXCLUDED.period, updated_at = NOW()`,
          [
            userId,
            store.safeToSpendPrefs.minimumBalanceReserve,
            store.safeToSpendPrefs.emergencyReserve,
            store.safeToSpendPrefs.savingsCommitment,
            store.safeToSpendPrefs.essentialExpenseReserve,
            store.safeToSpendPrefs.expectedRemainingIncome,
            store.safeToSpendPrefs.includeExpectedIncome,
            store.safeToSpendPrefs.period,
          ]
        ).catch(() => {});
      }
      sendJson(res, 200, { success: true, preferences: store.safeToSpendPrefs });
      return true;
    }

    // ------------------------------------------------------------------------
    // FEATURE 4: SMART ALERTS PREFERENCES & EVENT STATE
    // ------------------------------------------------------------------------

    if (pathname === '/api/finance/smart-alerts/state' && method === 'GET') {
      const store = readUserStore(userId);
      sendJson(res, 200, {
        success: true,
        preferences: store.smartAlertPrefs,
        eventState: store.smartAlertState,
      });
      return true;
    }

    if (pathname === '/api/finance/smart-alerts/preferences' && method === 'PUT') {
      const body = await parseJsonBody(req);
      const store = readUserStore(userId);
      store.smartAlertPrefs = {
        ...store.smartAlertPrefs,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : store.smartAlertPrefs.enabled,
        budgetEnabled: typeof body.budgetEnabled === 'boolean' ? body.budgetEnabled : store.smartAlertPrefs.budgetEnabled,
        budgetThresholds: Array.isArray(body.budgetThresholds)
          ? body.budgetThresholds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0 && n <= 200)
          : store.smartAlertPrefs.budgetThresholds,
        spendingAnomalyEnabled:
          typeof body.spendingAnomalyEnabled === 'boolean'
            ? body.spendingAnomalyEnabled
            : store.smartAlertPrefs.spendingAnomalyEnabled,
        billsEnabled: typeof body.billsEnabled === 'boolean' ? body.billsEnabled : store.smartAlertPrefs.billsEnabled,
        billNoticeDays: Array.isArray(body.billNoticeDays)
          ? body.billNoticeDays.map(Number).filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 30)
          : store.smartAlertPrefs.billNoticeDays,
        lowBalanceEnabled:
          typeof body.lowBalanceEnabled === 'boolean' ? body.lowBalanceEnabled : store.smartAlertPrefs.lowBalanceEnabled,
        lowBalanceThreshold:
          Number.isFinite(Number(body.lowBalanceThreshold)) && Number(body.lowBalanceThreshold) >= 0
            ? Number(body.lowBalanceThreshold)
            : store.smartAlertPrefs.lowBalanceThreshold,
        savingsMilestonesEnabled:
          typeof body.savingsMilestonesEnabled === 'boolean'
            ? body.savingsMilestonesEnabled
            : store.smartAlertPrefs.savingsMilestonesEnabled,
        udharRemindersEnabled:
          typeof body.udharRemindersEnabled === 'boolean'
            ? body.udharRemindersEnabled
            : store.smartAlertPrefs.udharRemindersEnabled,
        quietHoursEnabled:
          typeof body.quietHoursEnabled === 'boolean' ? body.quietHoursEnabled : store.smartAlertPrefs.quietHoursEnabled,
        quietHoursStart: typeof body.quietHoursStart === 'string' ? body.quietHoursStart.slice(0, 5) : store.smartAlertPrefs.quietHoursStart,
        quietHoursEnd: typeof body.quietHoursEnd === 'string' ? body.quietHoursEnd.slice(0, 5) : store.smartAlertPrefs.quietHoursEnd,
      };
      writeUserStore(userId, store);
      if (useDb) {
        query(
          `INSERT INTO public.smart_alert_preferences (user_id, config_json, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (user_id) DO UPDATE SET config_json = EXCLUDED.config_json, updated_at = NOW()`,
          [userId, JSON.stringify(store.smartAlertPrefs)]
        ).catch(() => {});
      }
      sendJson(res, 200, { success: true, preferences: store.smartAlertPrefs });
      return true;
    }

    if (pathname === '/api/finance/smart-alerts/events' && method === 'POST') {
      const body = await parseJsonBody(req);
      const action = body.action; // 'mark_read' | 'mark_all_read' | 'dismiss' | 'reset_dismissed'
      const keys: string[] = Array.isArray(body.keys) ? body.keys.map(String) : body.key ? [String(body.key)] : [];
      const store = readUserStore(userId);
      const readSet = new Set(store.smartAlertState.readKeys);
      const dismissedSet = new Set(store.smartAlertState.dismissedKeys);

      if (action === 'mark_read' || action === 'mark_all_read') {
        for (const k of keys) readSet.add(k);
      } else if (action === 'dismiss') {
        for (const k of keys) dismissedSet.add(k);
      } else if (action === 'reset_dismissed') {
        dismissedSet.clear();
      }

      store.smartAlertState = {
        readKeys: Array.from(readSet).slice(-400),
        dismissedKeys: Array.from(dismissedSet).slice(-400),
      };
      writeUserStore(userId, store);
      if (useDb && (action === 'mark_read' || action === 'mark_all_read' || action === 'dismiss')) {
        const status = action === 'dismiss' ? 'dismissed' : 'read';
        for (const k of keys.slice(0, 100)) {
          query(
            `INSERT INTO public.smart_alert_events (user_id, dedupe_key, status, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, dedupe_key) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
            [userId, k, status]
          ).catch(() => {});
        }
      }
      sendJson(res, 200, { success: true, eventState: store.smartAlertState });
      return true;
    }

    sendJson(res, 404, { success: false, message: 'AI / Finance API endpoint not found.' });
    return true;
  } catch (err: any) {
    if (err?.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { success: false, message: 'Uploaded image or payload is too large (max 5 MB).' });
      return true;
    }
    console.error(`[AI Finance API Error] ${method} ${pathname}:`, err?.message || err);
    sendJson(res, 500, { success: false, message: 'An internal error occurred while processing your request.' });
    return true;
  }
}
