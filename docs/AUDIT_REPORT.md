# EduTrack Production Audit Report

**Date:** 2026-05-16
**Auditor:** Senior Software Architect + Security Engineer
**Scope:** Full codebase production readiness audit
**Target:** Internal English center, ~1,000 users, scalable to 5,000-10,000

---

# A. Executive Summary

EduTrack is a well-architected Vietnamese education management platform built on React 19 + Vercel Serverless + Firebase Firestore. The payment system (PayOS) is impressively robust with webhook signature verification, transactional idempotency, double-payment prevention, and reconciliation. The authorization model is layered and consistent across all API endpoints. However, **the project is NOT ready for production deployment** due to two critical issues: (1) production secrets including Firebase private key, PayOS credentials, and Zalo tokens are committed to the repository and must be rotated immediately, and (2) quiz correct answers are exposed to students via client-side Firestore reads. Beyond these, there are ~15 medium-severity issues around missing audit logs, absent automated backups, frontend business logic leakage, and lack of input validation library. The architecture is sound for 1,000 users and can scale to 5,000-10,000 with index tuning and pagination, but needs the critical fixes below before going live.

**3 Biggest Risks:**

1. Compromised secrets in git history (Firebase key, PayOS keys, Zalo tokens)
2. Quiz answers visible to students via Firestore client reads
3. No automated database backup -- accidental deletion could lose financial data

---

# B. Production Readiness Verdict

**Verdict: CONDITIONAL -- Not Ready for Production**

**Reason:** Two critical security vulnerabilities and several high-severity operational gaps prevent safe deployment.

**Minimum conditions to deploy:**

1. Rotate ALL exposed secrets (Firebase, PayOS, Zalo, Gemini) and remove them from git history
2. Move quiz correct answers out of client-readable Firestore documents
3. Enable automated Firestore backup (or at minimum schedule daily manual exports)
4. Add audit logs to the 8 missing mutation endpoints
5. Add SRI hash to PayOS CDN script tag

---

# C. Architecture Assessment

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React SPA)                  │
│  Vite 6 + React 19 + TypeScript + Tailwind CSS 4        │
│  Direct Firestore reads (onSnapshot) for realtime data   │
│  API calls via apiClient.ts for mutations                │
└──────────┬──────────────────────┬────────────────────────┘
           │                      │
     ┌─────▼──────┐        ┌─────▼──────────┐
     │  Firebase   │        │  Vercel API    │
     │  Firestore  │        │  Serverless    │
     │  (reads)    │        │  (all writes)  │
     └─────▲──────┘        └──────┬─────────┘
           │                       │
     ┌─────┴──────┐        ┌──────▼─────────┐
     │  Firestore  │        │  Firebase Admin│
     │  Rules      │        │  SDK           │
     │  (read-only │        │  (bypass rules)│
     │   enforced) │        └──────┬─────────┘
     └────────────┘                 │
                             ┌──────▼─────────┐
                             │  External Svcs  │
                             │  PayOS, Zalo OA │
                             │  Gemini AI      │
                             │  Sentry         │
                             └─────────────────┘

     ┌─────────────────────────────────────────┐
     │  Realtime SSE Service (Cloud Run)        │
     │  Express.js + firebase-admin             │
     │  Scoped Firestore streaming              │
     └─────────────────────────────────────────┘
```

## Module Map

| Module         | Files                                                               | Responsibility                                           |
| -------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Auth           | `api/auth/[action].ts`, `api/lib/verifyAuth.ts`, `api/lib/authz.ts` | Login, password reset, token verification, RBAC          |
| Students       | `api/students/[action].ts`                                          | Student CRUD, profile updates                            |
| Classes        | `api/classes/[action].ts`                                           | Class management, substitute requests, ledger generation |
| Attendance     | `api/attendance/[action].ts`                                        | Daily attendance recording                               |
| Evaluations    | `api/evaluations/[action].ts`                                       | Scores, daily reports, session tracking, AI generation   |
| Assignments    | `api/assignments/[action].ts`                                       | Assignment CRUD, submission, grading                     |
| Finance        | `api/finance/[action].ts`                                           | Receipts, expenses, financial reports                    |
| Payments       | `api/payments/payos/[action].ts`                                    | PayOS integration, webhooks, reconciliation              |
| Notifications  | `api/zalo/[action].ts`                                              | Zalo OA messaging, ZNS templates                         |
| Knowledge Bank | `api/knowledge-bank/[action].ts`                                    | Document upload/download                                 |
| Staff          | `api/staff/[action].ts`                                             | Staff account management                                 |
| Audit          | `api/audit/[action].ts`                                             | Audit logs, data export, cleanup cron                    |
| Read API       | `api/read/[channel].ts`                                             | Server-side filtered reads                               |
| Realtime       | `realtime/server.mjs`                                               | SSE streaming for scoped Firestore data                  |

## Main Coupling Problems

1. **Frontend-Firestore coupling**: Pages directly subscribe to Firestore collections via `onSnapshot`, creating tight coupling between UI and data model. Schema changes break frontend.
2. **Denormalized data consistency**: Teacher names, class names stored in multiple documents. No automatic sync on update.
3. **Dual read path**: Frontend reads from both Firestore directly AND the `readApi` server endpoint, creating inconsistency risk.

## Single Points of Failure

1. **Firebase Firestore**: All data stored in one database instance. No read replicas.
2. **Vercel Serverless**: All API logic runs on Vercel. Platform outage = full system down.
3. **PayOS**: Single payment gateway. No fallback.
4. **Zalo OA**: Single notification channel. Zalo outage = no parent notifications.

## Recommended Architecture

Keep the current architecture. It is appropriate for the scale. Do NOT move to microservices. Key improvements:

- Add a thin service layer between API handlers and Firestore for shared business logic
- Move all reads through the server-side `readApi` to eliminate dual-path inconsistency
- Add a background job queue (Vercel cron or Cloud Tasks) for heavy operations

---

# D. Critical Findings

## CRITICAL-01: Production Secrets Committed to Repository

**Severity:** CRITICAL
**File:** `.env`, `service-account-key.json`
**Description:** Real production secrets are committed to the git repository. The `.env` file contains Firebase Admin SDK private key (full PEM), PayOS credentials (Client ID, API Key, Checksum Key), Zalo OA tokens (Access Token, App Secret, Refresh Token), and Gemini API key. The `service-account-key.json` file contains the full Firebase service account credential.
**Impact:** Anyone with repository access can: impersonate any user, create/modify/delete any Firestore document, process fraudulent payments via PayOS, send messages via Zalo OA, access Firebase Storage.
**Exploit scenario:** Clone repo -> extract `.env` -> use Firebase private key to mint custom tokens -> impersonate admin -> modify financial records.
**Recommended fix:**

1. Immediately rotate ALL credentials: Firebase private key, PayOS keys, Zalo tokens, Gemini key
2. Remove `.env` and `service-account-key.json` from git history using `git filter-branch` or BFG Repo-Cleaner
3. Use Vercel Environment Variables for all secrets (never commit them)
4. Add `service-account-key.json` to `.gitignore`
5. Enable Firebase App Check for additional protection
   **Priority:** IMMEDIATE -- must fix before any deployment

## CRITICAL-02: Quiz Correct Answers Exposed to Students

**Severity:** CRITICAL
**File:** `src/pages/Assignments.tsx`, Firestore `assignments` collection
**Description:** Assignment documents in Firestore contain `questions[].correct_answer` fields. The frontend reads these documents directly via `onSnapshot` for all users including students. A student can open browser DevTools, inspect the Firestore listener data, and see all correct answers before submitting.
**Impact:** Academic integrity completely compromised for all quiz-type assignments.
**Exploit scenario:** Student opens DevTools -> Network tab -> finds Firestore snapshot data -> reads correct answers -> gets perfect score.
**Recommended fix:**

1. Store correct answers in a separate subcollection `assignments/{id}/answers` that is only readable by teachers/admins via Firestore rules
2. OR: Remove correct answers from the document sent to students by using a Cloud Function/trigger that strips them before client delivery
3. The server-side grading endpoint (`api/assignments/[action].ts` `grade` action) should be the only place that compares answers
4. For self-grading quizzes, move grading entirely to the server: student submits answers, server grades and returns result
   **Priority:** IMMEDIATE -- must fix before students use the system

---

# E. Detailed Audit by Area

## E1. System Design

**Rating: GOOD**

The system follows a clean separation: frontend handles UI, Vercel serverless handles all mutations, Firestore handles data persistence. The use of Firestore rules to block all client-side writes is an excellent security pattern. The realtime SSE service is a smart architectural choice that avoids exposing Firestore query capabilities to clients.

**Issues:**

- No formal service layer -- business logic is embedded directly in API handlers
- Duplicate utility functions (`normalizeBody`, `getString`) across 3+ files
- No centralized error handling middleware for API routes

## E2. Database

**Rating: GOOD with gaps**

**Strengths:**

- 32 composite indexes covering all query patterns
- Transactions used for all critical operations (payments, receipts, student IDs)
- Consistent batch size limit (450, below Firestore's 500)
- Soft delete pattern for students and classes
- Comprehensive field validation in Firestore rules

**Issues:**

- **No automated backup**: Only manual SQL/Excel export. Financial collections (`receipts`, `expenses`, `payment_requests`, `course_fee_ledgers`) are NOT included in exports.
- **Denormalized data inconsistency**: When teacher name changes, denormalized copies in notifications/receipts are not updated.
- **No Cloud Functions**: No Firestore triggers for cascading updates. All sync must be done manually in API handlers.

## E3. Auth & Authorization

**Rating: EXCELLENT**

**Strengths:**

- Six well-defined roles with clear boundaries
- Firebase ID token verification with revocation check on every request
- `assertClassAccess` implements comprehensive resource-level authorization
- Student/parent passwords never leave the server (PBKDF2 + timing-safe comparison)
- `stripStudentCredentials` removes sensitive fields from all read responses

**Issues:**

- Default student password is date of birth (weak initial credential)
- `handleApprove` returns temp password in API response (logged in network traces)
- Legacy SHA-256 password hashing still supported (weaker than PBKDF2)

## E4. Security

**Rating: GOOD with critical exceptions**

**Strengths:**

- All mutations through server-side API (Firestore rules block client writes)
- CORS properly restricted to configured origins
- Rate limiting on all sensitive endpoints
- Webhook signature verification for PayOS
- No XSS vectors (React auto-escape, no dangerouslySetInnerHTML)
- CSRF mitigated by Bearer token auth pattern
- File upload validation (MIME, size, extension, path traversal prevention)

**Issues:**

- CRITICAL: Secrets in repository (see CRITICAL-01)
- CRITICAL: Quiz answers exposed (see CRITICAL-02)
- Input validation gaps: `handleGenerateAi` passes raw user input to Gemini API (prompt injection risk)
- `handleSyncGoogleSheets` URL validation too permissive (data exfiltration risk)
- Rate limiter `failOpen` on finance/webhook endpoints
- PayOS CDN script loaded without Subresource Integrity (SRI) hash
- Weak cron authorization in payOS reconcile endpoint (header/UA check)

## E5. Payment System

**Rating: EXCELLENT** (detailed in Section F below)

The payment system is the strongest part of the codebase. Webhook verification, transactional idempotency, double-payment prevention, reconciliation, and audit logging are all well-implemented.

## E6. Workflow & Business Logic

**Rating: GOOD**

**Strengths:**

- Clear workflow for student lifecycle (create -> enroll -> attend -> evaluate -> graduate/drop)
- Ledger-based tuition tracking with receipt posting/voiding transactions
- Substitute teacher request workflow
- Password reset workflow with multiple paths (Zalo OTP, manual request, admin reset)

**Issues:**

- Attendance status cycling computed client-side (race condition risk)
- Quiz grading happens client-side (security issue, see CRITICAL-02)
- Parent blocking logic (30-day check) computed client-side

## E7. Frontend

**Rating: GOOD**

**Strengths:**

- Code splitting with lazy loading for all pages
- ErrorBoundary with Sentry integration
- Consistent double-submit prevention with boolean guards
- Loading/empty/error states handled throughout
- Responsive design with mobile-first approach
- Design system documented in DESIGN.md

**Issues:**

- No centralized form validation library (validation scattered across handlers)
- Business logic in frontend that should be in backend (quiz grading, attendance cycling, rate limiting)
- Dark mode implemented via 300-line CSS override layer (fragile, maintenance burden)
- `firebase-admin` in frontend dependencies (should be devDependencies or separate package)
- No focus trapping in modals (accessibility)
- No ARIA labels on icon-only buttons (accessibility)

## E8. Backend/API

**Rating: GOOD**

**Strengths:**

- Consistent API pattern across all endpoints
- Token verification + role check on every endpoint
- Rate limiting on sensitive endpoints
- Input validation on most endpoints
- Error handling with Sentry reporting
- Health check endpoint

**Issues:**

- 8 mutation endpoints missing audit logs
- Duplicate utility functions across files
- Some endpoints use raw `req.body` without normalization
- Inconsistent error response format

## E9. Reliability

**Rating: ACCEPTABLE**

**Strengths:**

- ErrorBoundary catches React render errors
- Sentry for production error tracking
- `subscribeWithRetry` for Firestore listener resilience
- Firestore SDK assertion suppression for known SDK bugs
- Reconciliation cron for payment consistency

**Issues:**

- No automated backup (critical for financial data)
- No monitoring/alerting beyond Sentry
- No health check for realtime SSE service
- Audit log writes are fire-and-forget (silent failures)
- No circuit breaker for external services (PayOS, Zalo, Gemini)

## E10. Maintainability

**Rating: GOOD**

**Strengths:**

- TypeScript throughout with comprehensive type definitions (669 lines in types.ts)
- Clean folder structure following Vercel conventions
- Design system documented
- CI/CD with typecheck, lint, format, build, test
- Unit tests for critical paths (auth, payments, finance, rate limiting)
- E2E tests for auth and knowledge bank
- k6 load test scenarios

**Issues:**

- No centralized form validation
- Duplicate utility functions
- Dark mode CSS override layer is fragile
- Error messages inconsistently Vietnamese/English
- `@typescript-eslint/no-explicit-any` is OFF (weakens type safety)

## E11. Scalability

**Rating: GOOD for 1,000 users, ACCEPTABLE for 5,000-10,000**

**Current capacity:**

- Firestore: Handles 1,000 users easily. At 10,000 users, watch for read costs from realtime listeners.
- Vercel Serverless: Scales automatically. Cold starts may be noticeable.
- Realtime SSE (Cloud Run): Connection limits per user (5). Need to monitor total connections.

**Potential bottlenecks at scale:**

- Firestore realtime listener count per client (multiple subscriptions per page)
- Export endpoints generating large SQL/Excel files in-memory
- No pagination on several list views

**Recommendations:**

- Add pagination to all list endpoints
- Move level management data to server-side filtered reads
- Limit concurrent Firestore subscriptions per client
- Use streaming responses for large exports

## E12. DevOps/Deployment

**Rating: ACCEPTABLE**

**Strengths:**

- Vercel deployment with automatic preview URLs
- CI/CD pipeline (GitHub Actions) with typecheck, lint, format, build, test
- Cron jobs for cleanup and reconciliation
- Environment variable validation at startup
- Production checklist documented in `docs/vercel-production-checklist.md`

**Issues:**

- No staging environment (only production)
- No rollback plan documented
- No post-deploy verification checklist
- Secrets management needs improvement (Vercel env vars, not .env files)
- No monitoring dashboard beyond Sentry

---

# F. Payment Deep Dive

## F1. Current Lifecycle

```
Parent clicks "Pay" → handleCreate()
  │
  ├─ Auth: verify parent token
  ├─ Validate: parent owns this ledger
  ├─ Rate limit: max 5 active sessions per parent
  ├─ Calculate: amount = remaining tuition (SERVER-SIDE)
  ├─ Generate: unique orderCode via Firestore transaction counter
  ├─ Lock: reservePaymentIntent() in transaction
  │   ├─ Check _payment_locks for existing active payment
  │   ├─ If same amount exists → return reusable checkoutUrl
  │   ├─ If initializing → return 409
  │   └─ Otherwise → create new lock + payment_requests doc
  ├─ Create: PayOS payment link via SDK
  ├─ Update: payment_requests with checkoutUrl, status=pending
  └─ Audit: write audit log

Parent completes payment at PayOS
  │
  ├─ Webhook: PayOS sends POST to /api/v1/payments/payos/webhook
  │   ├─ Verify: HMAC signature via PayOS SDK
  │   ├─ Dedup: SHA-256 hash check against webhook_events
  │   ├─ Validate: code='00', success=true, amount>0
  │   ├─ Match: find payment_requests by orderCode
  │   └─ Post: postConfirmedPayment() in transaction
  │       ├─ Re-read payment doc (race condition protection)
  │       ├─ If already paid → return alreadyPaid
  │       ├─ Check amount matches (mismatch → needs_review)
  │       ├─ Check overpayment (→ needs_review)
  │       ├─ Create receipt in receipts collection
  │       ├─ Update ledger paidTotal and status
  │       ├─ Update payment status to paid
  │       └─ Write audit log
  │
  └─ Polling: Frontend polls status every 2.5s
      └─ If still pending → query PayOS gateway → refreshPaymentFromGateway()

Reconciliation (daily cron + manual button):
  ├─ Paginate all active/pending payments (100 per batch)
  ├─ For each: query PayOS gateway for current status
  ├─ If PAID but local=pending → postConfirmedPayment()
  ├─ If CANCELLED/EXPIRED → update local status
  └─ Log results

Admin resolve-review:
  ├─ For needs_review payments
  ├─ Verify via PayOS gateway
  ├─ approve → postConfirmedPayment()
  └─ reject → mark as failed
```

## F2. Failure Scenarios

| Scenario                                            | Current Handling                            | Risk Level |
| --------------------------------------------------- | ------------------------------------------- | ---------- |
| Parent double-clicks "Pay"                          | Lock mechanism returns existing checkoutUrl | LOW        |
| Webhook arrives twice                               | SHA-256 deduplication skips duplicate       | LOW        |
| Webhook + status poll race                          | Transaction re-read ensures idempotency     | LOW        |
| Amount mismatch in webhook                          | Triggers needs_review status                | LOW        |
| Overpayment detected                                | Triggers needs_review status                | LOW        |
| Orphaned webhook (no matching payment)              | Recorded as needs_review                    | LOW        |
| PayOS gateway down                                  | Reconciliation catches missed webhooks      | MEDIUM     |
| Stale payment amount (discount applied mid-payment) | Old payment marked stale, new one created   | LOW        |
| Receipt number collision                            | Transaction counter, date-scoped            | LOW        |

## F3. Double Payment Risks

**Risk: LOW** -- Well mitigated by:

1. `_payment_locks` collection prevents concurrent payment creation for same ledger+parent
2. `reservePaymentIntent` returns existing checkoutUrl if same amount
3. `postConfirmedPayment` checks `alreadyPaid` in transaction
4. Webhook deduplication via payload hash
5. Max 5 active sessions per parent cap

**Remaining risk:** If a parent uses a different device/browser, the lock mechanism still prevents double payment (same ledger+parent key). If the amount changes between attempts, the old payment is marked `stale`.

## F4. Fake Callback Risks

**Risk: LOW** -- Well mitigated by:

1. PayOS SDK `webhooks.verify()` validates HMAC signature
2. Invalid signatures rejected with 400 and recorded
3. Rate limited (20 invalid per 60s per IP)
4. Non-success webhooks (code != '00') logged but ignored

## F5. Missing Idempotency

The `create` endpoint does not have an explicit idempotency key, but the lock mechanism provides equivalent protection. For the same ledger+parent+amount, the existing checkoutUrl is reused.

## F6. Recommended Production Lifecycle

The current lifecycle is already production-grade. Minor improvements:

1. Add `manually_voided` status for accountant void operations (currently uses `failed`)
2. Make payment TTL configurable (currently hardcoded at 30 minutes)
3. Add SRI hash to PayOS CDN script
4. Make audit log writes non-blocking but logged (currently silently swallowed)

## F7. Suggested DB Fields

The current `payment_requests` schema is comprehensive. Consider adding:

- `voidedBy` (uid of accountant who voided)
- `voidedAt` (timestamp)
- `voidReason` (text)
- `gatewayResponseCode` (raw PayOS response code)
- `retryCount` (number of reconciliation attempts)

## F8. Webhook Pseudo-code (Current Implementation -- Already Idempotent)

```
handleWebhook(req, res):
  // 1. Rate limit per IP
  if rateLimitExceeded(req.ip, 100/60s) → return 429

  // 2. Payload size check
  if payloadSize > 64KB → return 413

  // 3. Signature verification
  webhookData = payos.webhooks.verify(req.body)
  if verificationFailed → log invalid_signature, return 400

  // 4. Deduplication
  eventHash = SHA256(rawPayload)
  if webhook_events[eventHash] exists with status processed|duplicate → skip, return 200

  // 5. Record webhook event
  save webhook_events[eventHash] = { raw, signatureValid, receivedAt }

  // 6. Validate success indicators
  if code != '00' or !success or amount <= 0 → log, return 200

  // 7. Find matching payment
  payment = find payment_requests by orderCode
  if not found → log needs_review, return 200

  // 8. Post payment (idempotent via transaction)
  result = postConfirmedPayment(payment, webhookData)
  if result.alreadyPaid → return 200  // Idempotent!
  if result.amountMismatch → mark needs_review, return 200

  // 9. Update webhook event status
  update webhook_events[eventHash] = { processingStatus: 'processed' }

  return 200
```

## F9. Accountant Manual Process

The system supports:

1. **Manual receipt creation**: Accountant creates receipt via Finance page -> ReceiptModal
2. **Receipt posting**: Transaction validates amounts, updates ledger
3. **Receipt voiding**: Transaction reverses ledger amounts
4. **Needs review resolution**: Admin/accountant approves or rejects anomalous payments
5. **Reconciliation**: Manual button + daily cron to sync with PayOS gateway

**Missing:** No `manually_voided` status distinction. Currently voided payments use generic status.

## F10. Reconciliation Process

**Automatic:** Daily cron at 08:00 UTC via `vercel.json` configuration
**Manual:** "Reconcile" button on Finance page
**Process:** Paginates all active/pending payments, queries PayOS gateway, updates local status, posts receipts for confirmed payments

---

# G. Recommended Architecture

## G1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      CDN (Vercel Edge)                       │
│                    Static assets + SPA                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   React SPA (Client)                         │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────────┐ │
│  │ Auth    │ │ Pages    │ │ Hooks   │ │ API Client       │ │
│  │ Context │ │ (lazy)   │ │ (data)  │ │ (Bearer token)   │ │
│  └─────────┘ └──────────┘ └─────────┘ └──────────────────┘ │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
    ┌──────▼──────┐                 ┌──────▼──────────────┐
    │  Firestore  │                 │  Vercel Serverless  │
    │  (reads     │                 │  API Routes         │
    │   via rules)│                 │  ┌───────────────┐  │
    └─────────────┘                 │  │ verifyAuth()  │  │
                                    │  │ authz.ts      │  │
    ┌───────────────┐               │  │ rateLimit()   │  │
    │ Realtime SSE  │               │  │ validateInput │  │
    │ (Cloud Run)   │               │  │ businessLogic │  │
    │ Scoped reads  │               │  │ auditLog()    │  │
    └───────────────┘               │  └───────────────┘  │
                                    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │   Firebase Admin SDK │
                                    │   Firestore writes   │
                                    │   Auth token mgmt    │
                                    └──────────┬───────────┘
                                               │
                              ┌─────────────────┼─────────────────┐
                              │                 │                 │
                       ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
                       │   PayOS     │  │  Zalo OA    │  │  Gemini AI  │
                       │  Payment    │  │  Messaging  │  │  Generation │
                       └─────────────┘  └─────────────┘  └─────────────┘
```

## G2. Module Boundaries (Recommended)

Keep the current structure. Add a thin service layer:

```
api/
  lib/
    services/          # NEW: shared business logic
      studentService.ts
      classService.ts
      financeService.ts
      paymentService.ts
      notificationService.ts
    authz.ts           # KEEP: authorization
    verifyAuth.ts      # KEEP: token verification
    rateLimit.ts       # KEEP: rate limiting
    auditLog.ts        # KEEP: audit logging
    ...
```

## G3. Data Ownership

| Data        | Owner                                      | Reader                                   |
| ----------- | ------------------------------------------ | ---------------------------------------- |
| Students    | Admin, Teacher (own class)                 | All roles (scoped)                       |
| Attendance  | Teacher (own class)                        | Admin, Teacher, Student, Parent          |
| Evaluations | Teacher (own class)                        | Admin, Teacher, Student, Parent          |
| Assignments | Teacher (own class)                        | Admin, Teacher, Student                  |
| Finance     | Admin, Accounting                          | Admin, Accounting                        |
| Payments    | Parent (create), Admin/Accounting (manage) | Parent (own), Admin, Accounting          |
| Audit Logs  | System                                     | Admin only                               |

## G4. Database Changes Needed

1. **New subcollection:** `assignments/{id}/answers` -- store correct answers separately, readable only by teachers/admins
2. **New fields on `payment_requests`:** `voidedBy`, `voidedAt`, `voidReason`
3. **New collection:** `backups` -- track automated backup status
4. **Index addition:** `audit_logs` on `(collection, action, timestamp desc)` for filtered queries

## G5. Deployment Topology

| Component  | Platform           | Scaling                           |
| ---------- | ------------------ | --------------------------------- |
| Frontend   | Vercel (static)    | CDN, auto                         |
| API        | Vercel Serverless  | Auto (Hobby plan: 100 concurrent) |
| Database   | Firebase Firestore | Auto (free tier: 50K reads/day)   |
| Storage    | Firebase Storage   | Auto                              |
| Realtime   | Google Cloud Run   | Manual scaling (min 0, max 10)    |
| Monitoring | Sentry             | SaaS                              |

## G6. Monitoring/Logging/Backup Plan

**Monitoring:**

- Sentry for error tracking (already configured)
- Vercel Analytics for performance
- Firebase Console for Firestore metrics
- Custom health check endpoint (already exists)

**Logging:**

- Vercel Function Logs (automatic)
- Audit logs in Firestore (already implemented)
- Webhook events in Firestore (already implemented)

**Backup:**

- Enable Firebase managed export (scheduled daily)
- Keep manual SQL/Excel export as secondary
- Add financial collections to export scope
- Test restore process quarterly

---

# H. Fix Roadmap

## Phase 1: Critical Fixes (1-3 days)

| #   | Fix                                                           | Effort | Files                                                                         |
| --- | ------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| 1   | Rotate ALL exposed secrets (Firebase, PayOS, Zalo, Gemini)    | 2h     | Vercel dashboard, Firebase console, PayOS dashboard, Zalo OA dashboard        |
| 2   | Remove `.env` and `service-account-key.json` from git history | 1h     | Git history                                                                   |
| 3   | Move quiz correct answers to separate subcollection           | 4h     | `api/assignments/[action].ts`, `firestore.rules`, `src/pages/Assignments.tsx` |
| 4   | Add SRI hash to PayOS CDN script                              | 30m    | `src/pages/ParentTuition.tsx`                                                 |
| 5   | Fix `handleSyncGoogleSheets` URL validation                   | 1h     | `api/audit/[action].ts`                                                       |
| 6   | Sanitize AI prompt input                                      | 2h     | `api/evaluations/[action].ts`                                                 |

## Phase 2: Production Stabilization (1-2 weeks)

| #   | Fix                                                              | Effort | Files                                                                                                              |
| --- | ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| 7   | Add audit logs to 8 missing endpoints                            | 4h     | `api/students/[action].ts`, `api/evaluations/[action].ts`, `api/attendance/[action].ts`, `api/classes/[action].ts` |
| 8   | Enable automated Firestore backup                                | 2h     | Firebase console, Vercel cron                                                                                      |
| 9   | Add financial collections to export scope                        | 3h     | `api/audit/[action].ts`                                                                                            |
| 11  | Move quiz grading to server-side                                 | 4h     | `api/assignments/[action].ts`, `src/pages/Assignments.tsx`                                                         |
| 12  | Move attendance status cycling to server-side                    | 2h     | `api/attendance/[action].ts`, `src/hooks/useAttendanceManager.ts`                                                  |
| 13  | Change rate limiter to `failClosed` on finance/webhook endpoints | 1h     | `api/lib/rateLimit.ts`, `api/finance/[action].ts`, `api/payments/payos/[action].ts`                                |
| 14  | Add form validation library (Zod)                                | 8h     | Multiple files                                                                                                     |

## Phase 3: Scalability & Maintainability (1 month)

| #   | Fix                                                          | Effort | Files                                                                               |
| --- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| 15  | Add pagination to all list endpoints                         | 8h     | Multiple API + frontend files                                                       |
| 16  | Create shared service layer for business logic               | 16h    | New `api/lib/services/` directory                                                   |
| 17  | Standardize error response format                            | 4h     | `api/lib/helpers.ts`, all handlers                                                  |
| 18  | Add focus trapping to modals                                 | 4h     | `src/components/ModalPortal.tsx`                                                    |
| 19  | Add ARIA labels to icon buttons                              | 4h     | Multiple component files                                                            |
| 20  | Consolidate duplicate utility functions                      | 2h     | `api/attendance/[action].ts`, `api/evaluations/[action].ts`, `api/auth/[action].ts` |
| 21  | Move `firebase-admin` to devDependencies or separate package | 1h     | `package.json`                                                                      |
| 22  | Refactor dark mode to use Tailwind `dark:` variants          | 16h    | `src/index.css`                                                                     |
| 23  | Add staging environment                                      | 4h     | Vercel dashboard                                                                    |
| 24  | Document rollback procedure                                  | 2h     | `docs/`                                                                             |

---

# I. Production Deployment Checklist

- [ ] **Secrets rotated** -- Firebase private key, PayOS keys, Zalo tokens, Gemini key all new
- [ ] **Secrets removed from git history** -- `.env` and `service-account-key.json` purged
- [ ] **Secrets in Vercel Environment Variables** -- not in .env files
- [ ] **Quiz answers moved to separate subcollection** -- students cannot see correct answers
- [ ] **SRI hash added to PayOS CDN script** -- supply chain protection
- [ ] **Google Sheets URL validation tightened** -- only allowed Google Apps Script URLs
- [ ] **AI prompt input sanitized** -- prevent prompt injection
- [ ] **Audit logs added to all mutation endpoints** -- no gaps in audit trail
- [ ] **Automated Firestore backup enabled** -- daily, includes financial collections
- [ ] **Financial collections added to export scope** -- receipts, expenses, payments, ledgers
- [ ] **Backend authorization enforced on all endpoints** -- verified via code review
- [ ] **Payment webhook signature verified** -- PayOS SDK verification in place
- [ ] **Payment idempotency implemented** -- lock mechanism + transaction re-read
- [ ] **Double payment prevention active** -- lock mechanism + alreadyPaid check
- [ ] **Rate limiting enabled on all sensitive endpoints** -- login, OTP, payments, mutations
- [ ] **Rate limiter set to failClosed on critical endpoints** -- finance, payments
- [ ] **CI/CD passing** -- typecheck, lint, format, build, test all green
- [ ] **Firestore rules deployed** -- client writes blocked, read access scoped
- [ ] **Storage rules deployed** -- avatars, student faces, knowledge bank secured
- [ ] **Indexes deployed** -- all 32 composite indexes active
- [ ] **Sentry DSN configured** -- error tracking active
- [ ] **Cron jobs configured** -- cleanup (daily 18:00 UTC), reconciliation (daily 08:00 UTC)
- [ ] **Health check responding** -- `/api/v1/audit/health` returns ok
- [ ] **CORS configured** -- `APP_URL` set to production domain
- [ ] **Domain/SSL ready** -- Vercel auto-provisions SSL
- [ ] **Firestore rules tested** -- rule test suite passing
- [ ] **Payment flow tested end-to-end** -- create, pay, webhook, receipt, reconcile
- [ ] **Rollback plan documented** -- Vercel instant rollback available
- [ ] **Post-deploy smoke test checklist** -- login, create student, attendance, payment

---

# J. Final Recommendation

**Should you deploy immediately?** No. Fix the 6 critical/high items in Phase 1 first (estimated 1-2 days of focused work).

**Minimum to deploy:**

1. Rotate all secrets and remove from git history (2-3 hours)
2. Move quiz answers to separate subcollection (4 hours)
3. Add SRI hash to PayOS script (30 minutes)
4. Tighten Google Sheets URL validation (1 hour)

**Architecture recommendation:** Keep the current architecture. It is well-suited for the scale and complexity. Do NOT refactor to microservices. The Vercel + Firestore + Cloud Run stack is appropriate.

**Top 5 things to do before production:**

1. **Rotate all secrets** -- this is non-negotiable
2. **Fix quiz answer exposure** -- academic integrity is at stake
3. **Enable automated backups** -- financial data must be protected
4. **Add missing audit logs** -- compliance and debugging
5. **Add staging environment** -- test before production

**Overall assessment:** This is a well-built system by a solo developer. The payment system is production-grade. The authorization model is excellent. The main risks are operational (secrets, backups) rather than architectural. With the Phase 1 fixes, this system is ready for production deployment serving 1,000 users.
