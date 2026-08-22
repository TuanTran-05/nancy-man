# Cloudflare Turnstile Login Design

## Goal

Add Cloudflare Turnstile verification to the main login actions so automated traffic must pass a bot check before credentials or Firebase sign-in flows are attempted.

Scope covers:

- Staff email/password login.
- Staff Google login.
- Student and parent code login.

Forgot-password and OTP flows are out of scope for this change because they already have separate protections and different UX.

## Requirements

- The browser renders a Turnstile widget on the login page.
- The frontend uses only the public site key from `VITE_TURNSTILE_SITE_KEY`.
- The backend validates each token using Cloudflare Siteverify and `TURNSTILE_SECRET_KEY`.
- The secret key is never exposed to client code.
- A login request without a valid Turnstile token is rejected before password verification, Firebase custom-token creation, or Firebase popup/email sign-in.
- Tokens are treated as single-use and short-lived. After each login attempt, success, error, expiry, or widget error, the frontend resets the widget and requires a fresh token.
- The implementation degrades clearly when Turnstile is not configured: login is blocked with a configuration error, and local/staging should use Cloudflare testing keys or mocked Siteverify responses in automated tests.

## Environment Variables

Frontend:

- `VITE_TURNSTILE_SITE_KEY`: public Cloudflare Turnstile site key.

Backend:

- `TURNSTILE_SECRET_KEY`: private Cloudflare Turnstile secret key.
- `TURNSTILE_EXPECTED_HOSTNAME`: optional hostname allow check for production hardening.

The user will configure the site key and secret key in Vercel environment variables.

## Frontend Design

Create a small Turnstile React wrapper for the login page:

- Load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once.
- Render the widget explicitly into a container because this is a React SPA.
- Pass `sitekey`, `theme: "auto"`, `action: "login"`, and callbacks for success, expiry, error, and unsupported states.
- Keep the current token in login state.
- Expose a reset function to clear the token and reset/remove the widget after each attempt.

Login page behavior:

- Show the widget in the login card for all role tabs.
- Disable staff email/password, staff Google, and student/parent submit actions until the widget returns a token.
- Include the current token in staff and student/parent login requests.
- Reset the widget after every attempted login because Turnstile tokens are single-use.

## Backend Design

Add `api/lib/auth/turnstile.ts`:

- Validate token shape before calling Cloudflare.
- Reject missing, non-string, or over-2048-character tokens.
- POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- Use a timeout so login requests do not hang indefinitely.
- Send `secret`, `response`, `remoteip`, and an `idempotency_key`.
- Check `success`.
- Check `action === "login"` when Cloudflare returns an action.
- Check `hostname === TURNSTILE_EXPECTED_HOSTNAME` when the optional env var is set.
- Return a small result object that handlers can turn into a user-friendly login error.

Apply backend verification at the earliest safe point:

- `handleVerifyStudentLogin`: require `turnstileToken` and validate it before student lookup and password checks.
- `handleStaffLoginRateCheck`: require `turnstileToken` and validate it before returning success to the email/password Firebase flow.
- Add a new unauthenticated `verify-turnstile-login` auth action for Google login so the client can validate Turnstile before opening the Google popup.

## Data Flow

Student/parent:

1. User completes Turnstile.
2. Client submits `studentCode`, `password`, `loginType`, and `turnstileToken`.
3. Backend validates Turnstile.
4. Backend continues existing rate limit, credential verification, profile materialization, custom-token creation, and audit logging.
5. Client signs in with the custom token.
6. Client resets Turnstile.

Staff email/password:

1. User completes Turnstile.
2. Client calls `staff-login-rate-check` with email and `turnstileToken`.
3. Backend validates Turnstile and existing rate limit.
4. Client signs in with Firebase email/password.
5. Client syncs staff profile through the existing authenticated `sync-login` endpoint.
6. Client resets Turnstile.

Staff Google:

1. User completes Turnstile.
2. Client calls `verify-turnstile-login` with `turnstileToken`.
3. Backend validates Turnstile.
4. Client opens the Google popup.
5. Client syncs staff profile through the existing authenticated `sync-login` endpoint.
6. Client resets Turnstile.

## Error Handling

- Missing site key: show a login error that bot verification is not configured and keep login actions blocked.
- Missing token: show a friendly "complete verification first" message.
- Expired or duplicate token: reset widget and ask the user to try again.
- Siteverify network/timeout failure: reject login and ask the user to retry.
- Backend should not expose Cloudflare raw error codes directly in user-facing text, but tests can assert structured error codes.
- Existing rate-limit and invalid-credential messages remain unchanged where possible.

## Tests

Backend tests:

- Turnstile helper rejects missing/malformed/too-long tokens without calling fetch.
- Turnstile helper accepts a successful Siteverify response with `action: "login"`.
- Turnstile helper rejects action mismatch and hostname mismatch.
- Student/parent login returns an error when `turnstileToken` is missing or invalid before credential work.
- Staff rate-check returns an error when `turnstileToken` is missing or invalid.
- Google Turnstile endpoint accepts valid tokens and rejects invalid tokens.

Frontend tests:

- Login submit buttons are disabled or blocked until a Turnstile token exists.
- Student/parent login sends `turnstileToken` in `verify-student-login`.
- Staff email/password sends `turnstileToken` in `staff-login-rate-check`.
- Google login calls the Turnstile verification endpoint before opening the popup.
- Widget reset is requested after login attempts.

Verification commands:

- `npm.cmd run typecheck`
- Targeted Vitest tests for Turnstile helper, auth handlers, and login hook/page.
- `npm.cmd run build`

## Rollout Notes

- Add Vercel env vars before deploying the feature.
- Use Cloudflare Turnstile testing keys in local or staging when needed.
- Unit tests should mock Siteverify responses instead of relying on a live Cloudflare request.
- Production should fail closed if `TURNSTILE_SECRET_KEY` is missing.
- Consider monitoring failed Turnstile validations alongside existing login rate-limit events after launch.
