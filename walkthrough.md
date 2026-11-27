# Security Summary

**Reviewed Files**: 12
**Issues Resolved**: 9

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Borrower Settle/Edit/Delete Bypass | `server/api.ts`, `server/supabaseRestUdhar.ts`, `src/components/people/UdharDetailModal.tsx` | 5258, 2416, 534 | Edit, settle, and delete permissions needed uniform lender-only (`direction === 'gave'`) enforcement across both Postgres and Supabase REST backends plus UI action visibility. | High | Fixed | Enforced server-side `403 Forbidden` when `counterpart_user_id` is set and `direction === 'took'` across `PUT`, `POST /settle`, and `DELETE`, and restricted UI Edit/Settle/Delete controls strictly to lenders (`direction === 'gave'`). |
| Self-Confirmation Bypass | `server/api.ts`, `server/supabaseRestUdhar.ts` | 4774, 2097 | An initiator could hit the confirmation endpoint for a shared transaction they created themselves instead of waiting for the recipient counterpart. | Medium | Fixed | Added `if (tx.is_initiator)` guards returning `403 Forbidden` in both Postgres and REST handlers so only the counterpart recipient can confirm or decline. |
| Admin Account Discovery Leak | `server/api.ts`, `server/supabaseRestUdhar.ts` | 2806, 580 | Direct contact creation, contact linking, QR token resolution, and shared Udhar endpoints could interact with admin/staff/inactive user IDs if known or queried directly. | High | Fixed | Applied `isDiscoverableNormalUser` (`role === 'user'`, active, not deleted) across People Search, QR resolution, QR connect, contact creation/linking, and shared Udhar creation, returning `403` on non-eligible targets and `410` on expired/used/revoked QRs. |
| Non-Atomic Settlement & Audit Gap | `server/api.ts`, `server/supabaseRestUdhar.ts`, `scripts/migrations/20261126_udhar_security_and_settlement_hardening.sql` | 5497, 2577, 152 | Concurrent settlement or cancellation in REST mode lacked conditional row-state filtering, `disputed` blocking, and `settled_by` / `deleted_by` / `deletion_reason` persistence. | Medium | Fixed | Enforced conditional `status=not.in.(settled,cancelled,disputed)` atomic updates in REST mode (`409` on race/settled/disputed), PG `FOR UPDATE` locking + `SAVEPOINT` fallback, and added SQL migration RPCs (`settle_udhar_atomic`, `cancel_udhar_atomic`). |
| Deleted/Cancelled Entry Balance Leak | `server/api.ts`, `server/supabaseRestUdhar.ts` | 4444, 1294 | Soft-deleted or cancelled Udhar rows could remain in transaction feeds or per-contact balance/count aggregates. | Medium | Fixed | Filtered out `status === 'cancelled' || deleted_at` from active transaction lists, balance totals, and `total_transactions_count` across Postgres and REST paths. |
| Client-Side Admin REST Bypass | `src/lib/authApi.ts`, `src/context/AuthContext.tsx` | 802, 618 | Client admin helper functions included fallback direct Supabase REST calls using the browser anon key, and profile/session checks could fall back to stale client storage. | High | Fixed | Removed all client-side anon Supabase admin fallback paths; routed admin actions strictly through backend `/api/admin/*` endpoints and profile fetches strictly through `/api/auth/me` and `/api/auth/profile` failing closed on `401`/`403`. |
| Admin Role Downgrade on Login | `src/context/AuthContext.tsx` | 140 | Signing in through the normal login path could fall back to a default `'user'` role if canonical `/api/auth/me` role verification was bypassed or stale. | Medium | Fixed | Resolved canonical `app_users.role` via `/api/auth/me` (and `profiles.role` when needed) during login and refresh so admins preserve their role without privilege downgrade. |
| Missing Admin View Guard | `src/App.tsx` | 478 | Navigating or toggling state to the `admin` tab needed an explicit `isAdmin` check alongside server-side API enforcement. | Medium | Fixed | Guarded the rendered admin panel container with `currentTab === 'admin' && isAdmin` in `src/App.tsx`. |
| Udhar RLS Admin Read Bypass | `RLS_POLICIES.sql`, `scripts/migrations/20261126_udhar_security_and_settlement_hardening.sql` | 644, 35 | Udhar transaction, repayment, and edit-history SELECT policies contained an `OR public.is_admin()` exception allowing broad ledger inspection at the RLS layer. | Medium | Fixed | Removed the admin bypass from `udhar_tx_select_participant`, `udhar_rep_select_participant`, and `udhar_hist_select_participant` so access is strictly scoped to participants (`user_id` or `counterpart_user_id`), ready to apply via the migration script. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Session & Token Integrity | `server/auth.ts` | Rejects unsigned tokens, validates HMAC-SHA256 fallback signatures and expiration timestamps, and verifies active user status on `/api/auth/me`. |
| Role-Based Access Control | `server/api.ts` | Every `/api/admin/*` route requires `authenticateRequest` + server-verified admin role check, returning `403` to normal users and unauthenticated requests. |
| Database Queries | `server/api.ts` | All PostgreSQL queries pass user inputs as `$1, $2, ...` bind parameters with row-level `FOR UPDATE` locks on settlement and deletion. |
| Multi-Transaction Isolation | `src/lib/sharedUdharEngine.ts`, `src/components/people/PeopleSection.tsx`, `src/components/people/PersonDetailsView.tsx` | Each Udhar entry has a unique `id`/`link_id`, renders individually, calculates Pending vs Settled totals separately, and settles or deletes only the targeted single entry. |
| Rate Limiting & Input Validation | `server/security.ts`, `server/api.ts` | Enforces per-user/IP rate limits on search, QR generation/resolve, connection requests, Udhar creation, settlement, and auth recovery endpoints. |

---

## PoC Verification

### 1. Borrower Attempting to Settle, Edit, or Delete a Shared Udhar
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Role/Perspective Authorization Check |
| Impact | High |
| Affected File | `server/api.ts:5258`, `server/api.ts:5459`, `server/api.ts:5606`, `server/supabaseRestUdhar.ts:2550`, `server/supabaseRestUdhar.ts:2663` |
| Test Scenario | Authenticated borrower (`direction === 'took'`, `rahulToken`) sends `POST /api/udhar/transactions/:id/settle`, `PUT /api/udhar/transactions/:id`, and `DELETE /api/udhar/transactions/:id` for an active ₹700 Udhar entry. |

#### How It Was Fixed
Server handlers check `if (tx.counterpart_user_id && tx.direction === 'took')` on the authenticated participant's perspective row before allowing mutation and reject with `403 Forbidden`, while UI components hide Settle/Edit/Delete unless `direction === 'gave'`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/udhar/transactions/:id/settle` authenticates `rahulToken` (`rahulId`) and loads Rahul's row (`direction: 'took'`, `counterpart_user_id: nileshId`). | Participant perspective resolved |
| 2 | Reaches `server/supabaseRestUdhar.ts:2550` (and `server/api.ts:5459` in PG mode): evaluates `tx.counterpart_user_id && tx.direction === 'took'`. | Condition matches borrower |
| 3 | Handler immediately returns HTTP `403` without modifying balance or status. Same guard fires at `2416`/`5258` for `PUT` and `2663`/`5606` for `DELETE`. | **Blocked with 403 Forbidden** |

#### Conclusion
**Fix Verified** - Only the lender (`direction === 'gave'`) can mutate, settle, or cancel an Udhar entry; borrower requests are blocked server-side with `403`.

---

### 2. Admin Account Discovery via People Search, QR Resolve, or Direct Shared Udhar
#### Summary
| Field | Value |
|---|---|
| Issue Type | Privileged Account Information Exposure |
| Impact | High |
| Affected File | `server/api.ts:3778`, `server/api.ts:3991`, `server/api.ts:4558`, `server/supabaseRestUdhar.ts:454`, `server/supabaseRestUdhar.ts:1731` |
| Test Scenario | Normal user queries `GET /api/udhar/users/search?q=hackifypro@gmail.com` or submits an admin user's QR token (`POST /api/udhar/qr/resolve`) or `adminId` to `POST /api/udhar/contacts` / `POST /api/udhar/transactions`. |

#### How It Was Fixed
All user discovery, QR resolution/connection, contact linking, and shared Udhar creation routes fetch `role`, `status`, and `deletion_status` from `app_users` and validate `isDiscoverableNormalUser(target)` before returning data or creating links.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `GET /api/udhar/users/search?q=hackifypro@gmail.com` passes auth and queries candidate rows. | Raw candidates filtered server-side |
| 2 | `isDiscoverableNormalUser` (`server/supabaseRestUdhar.ts:454`, `server/api.ts:3778`) checks `role === 'user'` and rejects `admin` / `superadmin`. | Admin account excluded (`users: []`) |
| 3 | `POST /api/udhar/qr/resolve` (`server/supabaseRestUdhar.ts:1731`), `POST /api/udhar/contacts` (`1358`), and `POST /api/udhar/transactions` (`1933`) hit `!isDiscoverableNormalUser(target)` and abort with HTTP `403 ACCOUNT_UNAVAILABLE`. | **Blocked & Hidden** |

#### Conclusion
**Fix Verified** - Admin accounts never appear in search results and cannot be resolved or linked via QR, contacts, or shared Udhar endpoints.

---

### 3. Deleting Already-Settled or Double-Settling a Multi-Transaction Entry
#### Summary
| Field | Value |
|---|---|
| Issue Type | State Integrity & Double-Settlement Prevention |
| Impact | Medium |
| Affected File | `server/supabaseRestUdhar.ts:2577`, `server/supabaseRestUdhar.ts:2676`, `server/api.ts:5497`, `server/api.ts:5619` |
| Test Scenario | Lender creates 5 separate Udhar entries (₹500, ₹1000, ₹700, ₹300, ₹2000), settles only ₹700, attempts to settle ₹700 a second time, then attempts `DELETE` on the settled ₹700 entry and `DELETE` on the pending ₹300 entry. |

#### How It Was Fixed
Settlement executes a conditional status guard (`status=not.in.(settled,cancelled,disputed)` in REST; `FOR UPDATE` + status check in PG) returning `409` on replay/race, and `canCancelUdhar` blocks deletion of settled/repaid/disputed entries with `409` while preserving audit history on pending deletions (`deleted_at`, `deleted_by`, `deletion_reason`).

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST .../settle` on entry #3 (₹700) conditionally updates `status='settled'`, `settled_by=nileshId`, leaving entries #1, #2, #4, #5 untouched (`pending`: ₹3,800, `settled`: ₹700). | Single entry settled atomically |
| 2 | Repeat `POST .../settle` on entry #3 encounters `tx.status === 'settled'` (`2571`) or 0 patched rows (`2603`). | Rejected (`400`/`409`) |
| 3 | `DELETE` on settled entry #3 triggers `canCancelUdhar` (`2676` / `5619`) and returns `409`; `DELETE` on pending entry #4 (₹300) sets `status='cancelled'` + `deleted_at`/`deleted_by` (`2697` / `5640`), reducing pending balance to ₹3,500 while keeping ₹700 settled intact. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Individual multi-transaction settlements and deletions remain strictly isolated, double settlement and post-settlement deletion are rejected, and audit metadata is preserved.

---

### 4. Unauthenticated / Normal User Access to Admin Routes & Expired Sessions
#### Summary
| Field | Value |
|---|---|
| Issue Type | Access Control & Session Validation |
| Impact | High |
| Affected File | `server/api.ts` (`/api/admin/*`), `server/auth.ts`, `src/App.tsx:478`, `src/lib/authApi.ts:802` |
| Test Scenario | Normal user sends `GET /api/admin/users` with a valid user session token, unauthenticated client requests `/api/admin/users`, and expired HMAC session token requests `GET /api/udhar/transactions`. |

#### How It Was Fixed
Admin API routes enforce server-side session authentication plus admin role checks, client-side anon Supabase admin helpers were removed from `src/lib/authApi.ts`, `/admin` UI rendering requires `isAdmin` in `src/App.tsx:478`, and `verifyFallbackSessionToken` fails closed on expired signatures.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `GET /api/udhar/transactions` with expired token fails `exp <= Date.now()` in `verifyFallbackSessionToken` (`server/auth.ts`). | Returns `401 UNAUTHORIZED` |
| 2 | `GET /api/admin/users` unauthenticated or with `nileshToken` (`role: 'user'`) fails admin role check in `server/api.ts`. | Returns `403 Forbidden` |
| 3 | `AuthContext` resolves `app_users.role` from `/api/auth/me` (`src/context/AuthContext.tsx:140`) without downgrading legitimate admins or granting UI access to normal users (`src/App.tsx:478`). | **Enforced Server & Client** |

#### Conclusion
**Fix Verified** - Expired sessions fail closed with `401`, normal users are blocked from `/api/admin/*` with `403` and cannot invoke client-side admin bypasses, and admins retain verified role access.
