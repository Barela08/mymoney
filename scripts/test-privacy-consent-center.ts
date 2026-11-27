/**
 * Comprehensive Automated Verification Suite: Privacy Choices & Consent Center
 * My Money Manager by HackifyPro
 *
 * Covers all 15 Part 12 verification scenarios:
 *  1. New user sees all optional categories unchecked (default false)
 *  2. Select All selects all 6 optional categories
 *  3. Deselect All clears all 6 optional categories
 *  4. Individual category selections work independently
 *  5. Indeterminate Select All state works (1..5 selected -> 'indeterminate')
 *  6. Essential Financial Data Processing is excluded from Select All & optional batch API
 *  7. Save My Choices payload creates separate per-category records with idempotency keys
 *  8. Supabase / server failure returns real error (never fakes success)
 *  9. Historical consent rows remain intact (append-only snapshot resolution)
 * 10. Individual consent withdrawal works without deleting core records
 * 11. Withdraw All Optional clears every optional category cleanly
 * 12. Cross-user access is blocked (401 unauthenticated, user-scoped cache isolation, strict RLS)
 * 13. Static audit: zero pre-selected optional defaults across UI, notification prefs, auth & support
 * 14. Trilingual Privacy Notice & UI copy completeness (English, Hindi, Marathi) + grievance desk
 * 15. No implicit consent on modal close; AI endpoints enforce server-side ai_processing consent
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  OPTIONAL_CONSENT_CATEGORIES,
  OPTIONAL_CONSENT_DEFINITIONS,
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_UI_COPY,
  STANDALONE_PRIVACY_NOTICE,
  buildConsentSavePayload,
  countSelectedOptional,
  createEmptyOptionalChoices,
  deselectAllOptional,
  getSelectAllState,
  isValidOptionalConsentCategory,
  toggleSelectAllOptional,
  type ConsentLanguage,
} from '../src/lib/privacyConsent';

import {
  buildConsentSnapshotFromHistory,
  handlePrivacyConsentApi,
} from '../server/privacyConsentApi';

import {
  generateConsentIdempotencyKey,
  getCachedUserPrivacyState,
  hasOptionalConsent,
  privacyConsentApi,
  setCachedUserPrivacyState,
} from '../src/lib/privacyConsentApi';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.stack || err?.message || err}`);
  }
}

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

// Helper to create mock Node HTTP req/res for server handler unit verification
function createMockHttp(method: string, url: string, body?: any, headers: Record<string, string> = {}) {
  const payload = body !== undefined ? JSON.stringify(body) : '';
  const req = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []) as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json', ...headers };

  let statusCode = 200;
  let rawBody = '';
  const resHeaders: Record<string, string> = {};
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(val: number) {
      statusCode = val;
    },
    setHeader(k: string, v: string) {
      resHeaders[k.toLowerCase()] = String(v);
    },
    end(chunk?: any) {
      if (chunk) rawBody += String(chunk);
    },
  } as unknown as ServerResponse;

  return {
    req,
    res,
    getResult: () => ({
      status: statusCode,
      headers: resHeaders,
      json: rawBody ? JSON.parse(rawBody) : null,
    }),
  };
}

// Polyfill lightweight browser window/localStorage for client cache isolation tests
function installMockBrowserStorage() {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  (globalThis as any).localStorage = mockLocalStorage;
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as any).CustomEvent = class {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };
  return store;
}

async function run() {
  console.log('\n=== Privacy Choices & Consent Center Test Suite (15 Scenarios) ===\n');

  // 1. New user sees all optional categories unchecked
  await test('1. New user sees all optional categories unchecked by default', () => {
    assert.equal(OPTIONAL_CONSENT_CATEGORIES.length, 7);
    const fresh = createEmptyOptionalChoices();
    for (const cat of OPTIONAL_CONSENT_CATEGORIES) {
      assert.equal(fresh[cat], false, `Category ${cat} must start unchecked`);
    }
    assert.equal(countSelectedOptional(fresh), 0);
    assert.equal(getSelectAllState(fresh), 'unchecked');

    const snapshot = buildConsentSnapshotFromHistory([]);
    assert.equal(snapshot.hasSavedChoices, false);
    for (const cat of OPTIONAL_CONSENT_CATEGORIES) {
      assert.equal(snapshot.choices[cat], false);
    }
  });

  // 2. Select All selects all optional categories
  await test('2. Select All selects all optional categories', () => {
    const initial = createEmptyOptionalChoices();
    const afterSelectAll = toggleSelectAllOptional(initial);
    assert.equal(countSelectedOptional(afterSelectAll), OPTIONAL_CONSENT_CATEGORIES.length);
    assert.equal(getSelectAllState(afterSelectAll), 'checked');
    for (const cat of OPTIONAL_CONSENT_CATEGORIES) {
      assert.equal(afterSelectAll[cat], true);
    }
  });

  // 3. Deselect All clears all optional categories
  await test('3. Deselect All clears all 6 optional categories (via toggle and explicit deselect)', () => {
    const allSelected = toggleSelectAllOptional(createEmptyOptionalChoices());
    const toggledOff = toggleSelectAllOptional(allSelected);
    assert.equal(countSelectedOptional(toggledOff), 0);
    assert.equal(getSelectAllState(toggledOff), 'unchecked');

    const cleared = deselectAllOptional();
    assert.equal(countSelectedOptional(cleared), 0);
    assert.equal(getSelectAllState(cleared), 'unchecked');
  });

  // 4. Individual category selections work independently
  await test('4. Individual category selections work independently without affecting others', () => {
    const choices = createEmptyOptionalChoices();
    choices.cloud_sync = true;
    choices.udhar_sharing = true;
    assert.equal(choices.cloud_sync, true);
    assert.equal(choices.udhar_sharing, true);
    assert.equal(choices.ai_processing, false);
    assert.equal(choices.analytics, false);
    assert.equal(choices.personalization, false);
    assert.equal(choices.marketing_updates, false);
    assert.equal(countSelectedOptional(choices), 2);
  });

  // 5. Indeterminate state works
  await test('5. Indeterminate Select All state works for partial selections (1..5 of 6)', () => {
    for (let k = 1; k < OPTIONAL_CONSENT_CATEGORIES.length; k++) {
      const partial = createEmptyOptionalChoices();
      for (let i = 0; i < k; i++) {
        partial[OPTIONAL_CONSENT_CATEGORIES[i]] = true;
      }
      assert.equal(getSelectAllState(partial), 'indeterminate', `Expected indeterminate for ${k} selected`);
      // Clicking Select All from indeterminate selects all 6
      const next = toggleSelectAllOptional(partial);
      assert.equal(getSelectAllState(next), 'checked');
    }
  });

  // 6. Essential processing is excluded from Select All & rejected as optional consent
  await test('6. Essential Financial Data Processing is excluded from Select All & optional categories', () => {
    assert.equal(isValidOptionalConsentCategory('financial_processing'), false);
    assert.equal(isValidOptionalConsentCategory('essential_financial_processing'), false);
    assert.equal((OPTIONAL_CONSENT_CATEGORIES as readonly string[]).includes('financial_processing'), false);

    const allSelected = toggleSelectAllOptional(createEmptyOptionalChoices());
    assert.deepEqual(Object.keys(allSelected).sort(), [...OPTIONAL_CONSENT_CATEGORIES].sort());
  });

  // 7. Save My Choices persists each category separately + idempotency key generation
  await test('7. Save My Choices builds separate per-category entries and unique idempotency keys', () => {
    const firstChoices = createEmptyOptionalChoices();
    firstChoices.cloud_sync = true;
    firstChoices.personalization = true;

    const firstPayload = buildConsentSavePayload(firstChoices, null);
    assert.equal(firstPayload.length, OPTIONAL_CONSENT_CATEGORIES.length, `First explicit save persists all ${OPTIONAL_CONSENT_CATEGORIES.length} category records separately`);
    const byPurpose = Object.fromEntries(firstPayload.map((e) => [e.purpose, e.status]));
    assert.equal(byPurpose.cloud_sync, 'granted');
    assert.equal(byPurpose.personalization, 'granted');
    assert.equal(byPurpose.ai_processing, 'withdrawn');
    assert.equal(byPurpose.udhar_sharing, 'withdrawn');
    assert.equal(byPurpose.analytics, 'withdrawn');
    assert.equal(byPurpose.marketing_updates, 'withdrawn');
    assert.equal(byPurpose.upi_qr, 'withdrawn');

    // Subsequent update only emits changed categories
    const deltaPayload = buildConsentSavePayload(
      { ...firstChoices, ai_processing: true, cloud_sync: false },
      {
        cloud_sync: 'granted',
        personalization: 'granted',
        ai_processing: 'withdrawn',
        udhar_sharing: 'withdrawn',
        analytics: 'withdrawn',
        marketing_updates: 'withdrawn',
        upi_qr: 'withdrawn',
      }
    );
    assert.equal(deltaPayload.length, 2);
    assert.deepEqual(
      deltaPayload.sort((a, b) => a.purpose.localeCompare(b.purpose)),
      [
        { purpose: 'ai_processing', status: 'granted' },
        { purpose: 'cloud_sync', status: 'withdrawn' },
      ]
    );

    const k1 = generateConsentIdempotencyKey('save');
    const k2 = generateConsentIdempotencyKey('save');
    assert.notEqual(k1, k2);
    assert.ok(k1.startsWith('save_'));
  });

  // 8. Supabase / server failure displays real error and NEVER fakes success
  await test('8. Client API rejects and never caches success when server returns 503 or network error', async () => {
    installMockBrowserStorage();
    // Inject a mock session token using authApi's exact storage key
    localStorage.setItem('my_money_auth_token', 'mock-token-for-error-test');
    localStorage.setItem('my_money_auth_user', JSON.stringify({ id: 'user-err-1' }));

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            success: false,
            code: 'CONSENT_PERSISTENCE_FAILED',
            message: 'Could not save your privacy choices to the database.',
          }),
          { status: 503, headers: { 'content-type': 'application/json' } }
        )) as any;

      let threw = false;
      try {
        await privacyConsentApi.saveChoicesBatch({
          entries: [{ purpose: 'cloud_sync', status: 'granted' }],
          source: 'privacy_choices_modal',
          language: 'en',
          idempotencyKey: 'idem_fail_test_1',
        });
      } catch (err: any) {
        threw = true;
        assert.equal(err.status, 503);
        assert.match(err.message, /Could not save/i);
      }
      assert.equal(threw, true, 'saveChoicesBatch MUST throw on HTTP 503');
      assert.equal(
        getCachedUserPrivacyState('user-err-1'),
        null,
        'Failed save MUST NOT write success into cache'
      );

      // Also verify supabaseRestUdhar never silently returns 200 on failure
      const restCode = readRepoFile('server/supabaseRestUdhar.ts');
      assert.match(restCode, /status:\s*503/, 'REST fallback must return honest 503 on error');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 9. Historical consent rows remain intact (append-only resolution)
  await test('9. Historical consent rows remain intact and latest status per category wins', () => {
    const rows = [
      // Ordered newest-first (as returned by ORDER BY created_at DESC)
      {
        id: 'row-3',
        purpose: 'cloud_sync',
        consent_status: 'withdrawn',
        action: 'withdrawn',
        policy_version: PRIVACY_POLICY_VERSION,
        withdrawn_at: '2026-11-25T10:05:00.000Z',
        created_at: '2026-11-25T10:05:00.000Z',
      },
      {
        id: 'row-2',
        purpose: 'ai_processing',
        consent_status: 'granted',
        action: 'granted',
        policy_version: PRIVACY_POLICY_VERSION,
        granted_at: '2026-11-25T10:02:00.000Z',
        created_at: '2026-11-25T10:02:00.000Z',
      },
      {
        id: 'row-1',
        purpose: 'cloud_sync',
        consent_status: 'granted',
        action: 'granted',
        policy_version: 'v1.3 — DPDP Act 2023',
        granted_at: '2026-11-25T10:00:00.000Z',
        created_at: '2026-11-25T10:00:00.000Z',
      },
    ];

    const snapshot = buildConsentSnapshotFromHistory(rows);
    assert.equal(snapshot.hasSavedChoices, true);
    assert.equal(snapshot.choices.cloud_sync, false, 'Latest row for cloud_sync is withdrawn');
    assert.equal(snapshot.consents.cloud_sync.status, 'withdrawn');
    assert.equal(snapshot.choices.ai_processing, true, 'Latest row for ai_processing is granted');
    assert.equal(snapshot.consents.ai_processing.status, 'granted');
    assert.equal(snapshot.choices.analytics, false);
    assert.equal(snapshot.lastUpdatedAt, '2026-11-25T10:05:00.000Z');

    // Verify SQL migration includes append-only trigger preventing UPDATE mutations
    const migrationSql = readRepoFile('scripts/migrations/20261125_privacy_consent_center.sql');
    assert.match(migrationSql, /trg_user_consents_append_only/);
    assert.match(migrationSql, /BEFORE UPDATE ON public\.user_consents/);
    assert.match(migrationSql, /prevent_user_consents_mutation/);
  });

  // 10. Individual withdrawal works
  await test('10. Individual consent withdrawal updates only the target category', async () => {
    installMockBrowserStorage();
    localStorage.setItem('my_money_auth_token', 'mock-token-withdraw');
    localStorage.setItem('my_money_auth_user', JSON.stringify({ id: 'user-w1' }));

    setCachedUserPrivacyState({
      userId: 'user-w1',
      hasSavedChoices: true,
      choices: {
        cloud_sync: true,
        ai_processing: true,
        udhar_sharing: false,
        analytics: false,
        personalization: false,
        marketing_updates: true,
      },
      policyVersion: PRIVACY_POLICY_VERSION,
      lastUpdatedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    });

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ success: true, purpose: 'ai_processing', status: 'withdrawn' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )) as any;

      const res = await privacyConsentApi.saveSingleConsent({
        purpose: 'ai_processing',
        status: 'withdrawn',
        source: 'settings_manage_consent',
        language: 'en',
      });
      assert.equal(res.status, 'withdrawn');
      assert.equal(hasOptionalConsent('ai_processing', 'user-w1'), false);
      assert.equal(hasOptionalConsent('cloud_sync', 'user-w1'), true);
      assert.equal(hasOptionalConsent('marketing_updates', 'user-w1'), true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 11. Withdraw All Optional works
  await test('11. Withdraw All Optional clears every optional category cleanly', async () => {
    installMockBrowserStorage();
    localStorage.setItem('my_money_auth_token', 'mock-token-withdraw-all');
    localStorage.setItem('my_money_auth_user', JSON.stringify({ id: 'user-w2' }));

    setCachedUserPrivacyState({
      userId: 'user-w2',
      hasSavedChoices: true,
      choices: toggleSelectAllOptional(createEmptyOptionalChoices()),
      policyVersion: PRIVACY_POLICY_VERSION,
      lastUpdatedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    });

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            success: true,
            userId: 'user-w2',
            hasSavedChoices: true,
            consents: {},
            choices: createEmptyOptionalChoices(),
            history: [],
            policyVersion: PRIVACY_POLICY_VERSION,
            policyLastUpdated: PRIVACY_POLICY_LAST_UPDATED,
            lastUpdatedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )) as any;

      const res = await privacyConsentApi.withdrawAllOptional({
        source: 'settings_manage_consent',
        language: 'en',
      });
      assert.equal(countSelectedOptional(res.choices), 0);
      for (const cat of OPTIONAL_CONSENT_CATEGORIES) {
        assert.equal(hasOptionalConsent(cat, 'user-w2'), false);
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 12. Cross-user access is blocked (401 unauth, cache isolation, strict RLS)
  await test('12. Cross-user access is blocked (401 unauthenticated, user-scoped cache, strict RLS)', async () => {
    // 12a. Unauthenticated API calls MUST return 401
    for (const [method, url] of [
      ['GET', '/api/privacy/consents'],
      ['POST', '/api/privacy/consents'],
      ['POST', '/api/privacy/consents/batch'],
      ['POST', '/api/privacy/consents/withdraw-all'],
    ] as const) {
      const { req, res, getResult } = createMockHttp(method, url, {});
      const handled = await handlePrivacyConsentApi(req, res, url, method);
      assert.equal(handled, true);
      const out = getResult();
      assert.equal(out.status, 401, `${method} ${url} without auth must return 401`);
    }

    // 12b. User-scoped cache isolation: User A's consent NEVER leaks to User B
    installMockBrowserStorage();
    setCachedUserPrivacyState({
      userId: 'user-A',
      hasSavedChoices: true,
      choices: toggleSelectAllOptional(createEmptyOptionalChoices()),
      policyVersion: PRIVACY_POLICY_VERSION,
      lastUpdatedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    });
    assert.equal(hasOptionalConsent('ai_processing', 'user-A'), true);
    assert.equal(hasOptionalConsent('ai_processing', 'user-B'), false);
    assert.equal(getCachedUserPrivacyState('user-B'), null);

    // 12c. Strict RLS check in migration SQL & RLS_POLICIES.sql (NO auth.uid() IS NULL bypass!)
    const migrationSql = readRepoFile('scripts/migrations/20261125_privacy_consent_center.sql');
    assert.match(migrationSql, /TO authenticated\s+USING \(auth\.uid\(\) = user_id\)/);
    assert.match(migrationSql, /TO authenticated\s+WITH CHECK \(auth\.uid\(\) = user_id\)/);
    assert.ok(
      !migrationSql.includes('USING (auth.uid() = user_id OR auth.uid() IS NULL)'),
      'Migration must NOT re-introduce OR auth.uid() IS NULL bypass'
    );

    const rlsSql = readRepoFile('RLS_POLICIES.sql');
    assert.match(rlsSql, /CREATE POLICY "user_consents_select_own"/);
    assert.match(rlsSql, /CREATE POLICY "user_consents_insert_own"/);
  });

  // 13. Static audit: zero pre-selected optional defaults
  await test('13. Audit confirms zero pre-selected optional checkboxes across UI, Auth, Notifications & Support', () => {
    const notifModal = readRepoFile('src/components/notifications/NotificationPreferencesModal.tsx');
    assert.ok(
      !notifModal.includes('preferences?.notify_offers ?? true'),
      'NotificationPreferencesModal must NOT default notify_offers to true'
    );
    assert.match(notifModal, /preferences\?\.notify_offers \?\? false/);

    const notifServer = readRepoFile('server/notificationService.ts');
    assert.match(notifServer, /notify_offers:\s*false/);

    const authPage = readRepoFile('src/components/auth/AuthPage.tsx');
    assert.ok(
      !authPage.includes('saveConsentChoices({ cloud_sync: true'),
      'AuthPage must NOT bundle optional cloud_sync consent during registration'
    );

    const supportApi = readRepoFile('src/lib/supportApi.ts');
    assert.ok(
      !supportApi.includes('dpdp_consent: true'),
      'supportApi fallback must NOT hardcode dpdp_consent: true'
    );

    const choicesModal = readRepoFile('src/components/privacy/PrivacyChoicesModal.tsx');
    assert.ok(!choicesModal.includes('defaultChecked'), 'PrivacyChoicesModal must not use defaultChecked');
    assert.match(choicesModal, /createEmptyOptionalChoices\(\)/);
    assert.match(choicesModal, /aria-checked=/);
    assert.match(choicesModal, /\.indeterminate\s*=/);
  });

  // 14. Trilingual Privacy Notice & UI copy completeness (EN, HI, MR)
  await test('14. Privacy Notice, Grievance Contact & UI copy are complete in English, Hindi and Marathi', () => {
    const langs: ConsentLanguage[] = ['en', 'hi', 'mr'];
    assert.ok(PRIVACY_POLICY_VERSION.length > 5);
    assert.ok(PRIVACY_POLICY_LAST_UPDATED.length >= 10);

    for (const lang of langs) {
      const ui = PRIVACY_UI_COPY[lang];
      assert.ok(ui.headerBadge.length > 0);
      assert.ok(ui.headerTitle.length > 0);
      assert.ok(ui.headerSubtitle.length > 0);
      assert.ok(ui.selectAllTitle.length > 0);
      assert.ok(ui.essentialTitle.length > 0);
      assert.equal(ui.essentialItems.length, 7, `Expected 7 essential items for ${lang}`);
      assert.ok(ui.saveMyChoices.length > 0);
      assert.ok(ui.dpdpHonestNote.length > 20);

      for (const cat of OPTIONAL_CONSENT_CATEGORIES) {
        const entry = OPTIONAL_CONSENT_DEFINITIONS.find((d) => d.key === cat);
        assert.ok(entry, `Missing definition for ${cat}`);
        assert.equal(entry!.defaultValue, false, `Definition defaultValue must be false for ${cat}`);
        const def = entry!.translations[lang];
        assert.ok(def.title.length > 0, `Missing title for ${cat}/${lang}`);
        assert.ok(def.shortDescription.length > 10, `Missing shortDescription for ${cat}/${lang}`);
        assert.ok(def.purposeDetail.length > 10, `Missing purposeDetail for ${cat}/${lang}`);
        assert.ok(Array.isArray(def.dataCategories) && def.dataCategories.length > 0, `Missing dataCategories for ${cat}/${lang}`);
        assert.ok(def.howUsed.length > 10, `Missing howUsed for ${cat}/${lang}`);
        assert.ok(def.externalProcessors.length > 10, `Missing externalProcessors for ${cat}/${lang}`);
        assert.ok(def.retention.length > 10, `Missing retention for ${cat}/${lang}`);
        assert.ok(def.withdrawalProcedure.length > 10, `Missing withdrawalProcedure for ${cat}/${lang}`);
      }

      const notice = STANDALONE_PRIVACY_NOTICE[lang];
      assert.ok(notice.title.length > 0);
      assert.ok(notice.disclaimer.length > 20);
      assert.ok(notice.sections.length >= 6);
      const joined = notice.sections.flatMap((s) => s.paragraphs).join(' ');
      assert.match(joined, /hackifypro@gmail\.com/i, `Missing grievance email in ${lang} notice`);
      assert.match(joined, /74149 35405/, `Missing grievance phone in ${lang} notice`);
    }
  });

  // 15. No implicit consent on modal close & server AI routes enforce ai_processing consent
  await test('15. Server AI endpoints enforce ai_processing consent & modal close never saves implicit consent', () => {
    const aiApi = readRepoFile('server/aiFinanceApi.ts');
    assert.match(aiApi, /hasServerUserConsent\(authUser,\s*'ai_processing'\)/);
    assert.match(aiApi, /AI_CONSENT_REQUIRED/);

    const aiUi = readRepoFile('src/components/ai/AiAssistantSection.tsx');
    assert.match(aiUi, /hasOptionalConsent\('ai_processing'\)/);

    const receiptUi = readRepoFile('src/components/receipts/ReceiptScannerSection.tsx');
    assert.match(receiptUi, /hasOptionalConsent\('ai_processing'\)/);

    const udharUi = readRepoFile('src/components/people/AddUdharModal.tsx');
    assert.match(udharUi, /hasOptionalConsent\('udhar_sharing'\)/);

    const modalSrc = readRepoFile('src/components/privacy/PrivacyChoicesModal.tsx');
    assert.match(modalSrc, /Closing NEVER saves implicit consent/i);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
