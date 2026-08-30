# Ops runtime boundaries

`man.thienuy.edu.vn` is one public TLS origin with two independent
loopback applications. Nginx is the sole boundary between them; neither
application is publicly bound.

| Public namespace | Owner | Loopback listener | Authentication state |
| --- | --- | --- | --- |
| `/healthz`, `/api/v1` and `/api/v1/**` | Ops API | `127.0.0.1:3100` | PostgreSQL `ops_sessions`; cookie `__Host-ops-session` |
| `/api`, `/api/**`, `/` and static UI fallback | Monitoring web | `127.0.0.1:3101` | Monitoring SQLite `ops.sqlite`; cookie `__Host-ops_session` |

The two account stores, session stores, session peppers, and cookie names are
deliberately distinct. A request reaching one plane must never authorize by
presenting the other plane's cookie: the API accepts only its hyphenated
`__Host-ops-session` token through its PostgreSQL-backed session authorizer,
while the monitoring web accepts only its underscored `__Host-ops_session`
token through its SQLite-backed auth service. Both cookies are host-only,
`Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`; same-origin delivery is
not shared authorization.

Nginx gives the exact monitoring login route its retained `ops_login` rate
limit. It also forwards client/protocol/request-id headers, bounds body sizes
and upstream timeouts, sends HSTS/noindex/content-type protection, and uses a
UI-compatible CSP. The `/api/v1/` prefix is more specific than `/api/`, so no
Ops API endpoint can fall through to the monitoring web application.
