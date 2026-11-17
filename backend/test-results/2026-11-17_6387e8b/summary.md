# Backend test run 2026-11-17 (6387e8b)

- Commit: `6387e8b286f84b862fba05b6c1c7f74c3be1513f`
- Recorded: 2026-11-17T23:54:01.292Z
- Node v22.22.0 on Linux 6.18.44-fc-v553 (x64)
- PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) (a separate test database, wiped and re-seeded by each test file)
- Exit code: 0 (all tests passed)
- Coverage of backend source: 97.38% lines, 89.53% branches, 94.62% functions

| Test file | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| agreements.test.js | 18 | 18 | 0 | 0 |
| api.test.js | 47 | 47 | 0 | 0 |
| config.test.js | 7 | 7 | 0 | 0 |
| modules.test.js | 22 | 22 | 0 | 0 |
| providers.test.js | 14 | 14 | 0 | 0 |
| units.test.js | 51 | 51 | 0 | 0 |
| verification.test.js | 7 | 7 | 0 | 0 |
| **Total** | **166** | **166** | **0** | **0** |

## What this run covers that a unit test cannot

- **Real database.** Every file except `units.test.js` and `config.test.js` runs the Express app against PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), and checks the rows written, not only the HTTP answers.
- **Provider failures.** `providers.test.js` switches on the real Termii, Brevo and Paystack classes and replaces only the network. It checks what happens when each provider is unreachable or refuses: the user sees a plain message, no money is recorded for a failed checkout, a failed payout is marked failed and the administrators are told, queued SMS stay queued until the provider is back, and a failed reset email gives the same answer as an unknown address.

## What this run does not cover

- Real SMS or email delivery to a phone or inbox, and real money through Paystack: the providers are simulated at the network level.
- Physical phones and browsers other than the one Node uses. Those results are recorded by hand in `docs/evidence/device-tests.md`.
