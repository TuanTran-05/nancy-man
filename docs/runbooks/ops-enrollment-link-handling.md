# Enrollment-link handling

Enrollment URLs are bearer credentials. They are HTTPS-only, single-use, and
valid for 24 hours. The clear URL is returned once by the owner/admin action
or offline bootstrap and is held only in the operator's transient memory.

## Delivery

1. Confirm the recipient identity out of band before generating or delivering
   a link.
2. Generate one link for one user and record only the user ID, enrollment ID,
   expiry timestamp, and reason code.
3. Display or transmit the clear URL only through the approved private
   channel. Do not include it in email subject lines, tickets, chat history,
   screenshots, shell history, referrer URLs, analytics, telemetry, or logs.
4. Tell the recipient to open the URL directly over HTTPS, set a new password,
   and enroll TOTP. The recipient must not forward or bookmark it.

## Consumption and expiry

- The server stores only a keyed/cryptographic token hash and the user/link
  metadata. It never returns the token after the initial response.
- A successful enrollment consumes the token atomically and activates the
  selected factor with a fresh password credential.
- A second request, expiry, administrative lock, permanent revoke, or
  replacement link invalidates the previous token. Treat every rejected reuse
  as expected and record only its reason code.
- At 24 hours, verify the token is unusable and that cleanup removes only
  expired metadata according to the retention policy.

## Suspected disclosure

Immediately revoke the affected pending token and any related sessions or
challenges, issue a value-free incident, and generate a replacement only after
recipient identity is reverified. Do not paste the exposed URL into the
incident. If the user has already enrolled, lock the account, require recovery
re-enrollment, and review account-event IDs before unlocking.

## Evidence rules

Evidence may contain only user/link IDs, status, expiry, reason codes, and
event IDs. Search output must be a boolean/count result that cannot echo a
URL, token, request body, browser storage entry, or credential fragment.
