# Operations ownership record — private completion template

Copy this file to the ignored `private/operations-ownership.md` directory and
complete it before any production deployment. Do not place credentials, IP
addresses, database URLs, private keys, recovery codes, or personal contact
details in the repository.

| Responsibility | Host or system identifier | Accountable owner | Backup owner | Last verified |
| --- | --- | --- | --- | --- |
| Production PostgreSQL | `TBD` | `TBD` | `TBD` | `TBD` |
| Ops application | `TBD` | `TBD` | `TBD` | `TBD` |
| Backup repository | `TBD` | `TBD` | `TBD` | `TBD` |
| Warm standby | `TBD` | `TBD` | `TBD` | `TBD` |
| Isolated restore target | `TBD` | `TBD` | `TBD` | `TBD` |
| DNS for man.thienuy.edu.vn | `TBD` | `TBD` | `TBD` | `TBD` |
| Zalo alert destination | `TBD` | `TBD` | `TBD` | `TBD` |
| SMTP alert destination | `TBD` | `TBD` | `TBD` | `TBD` |
| Primary on-call | `TBD` | `TBD` | `TBD` | `TBD` |
| Recovery cutover decision | `TBD` | `TBD` | `TBD` | `TBD` |

## Required acknowledgement

- The backup, standby and isolated-restore host identifiers are each distinct
  from the production PostgreSQL host identifier.
- The recovery decision maker understands that point-in-time restore never
  performs a production cutover automatically.
- The primary on-call can receive both Zalo and SMTP alerts.
