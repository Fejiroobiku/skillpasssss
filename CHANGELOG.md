# Changelog

## Updates to the current app (17 November 2026)

Made after facilitator feedback on the submitted version (commit 247ebe3). The submitted version is unchanged in the
history; these commits come after it.

- **Job matching:** each weight must now be a number from 0 to 1, so a match score can never leave 0 to 100
  (weights of -0.2 and 1.2 used to give 110). Equal scores are broken by skills held, then distance. New tests cover
  invalid settings, the boundaries, 2,000 random settings and realistic Lagos jobs.
- **Provider failures:** `backend/tests/providers.test.js` runs the app on PostgreSQL with Termii, Brevo and Paystack
  switched on and makes each one unreachable or refuse, checking both the message the user sees and the database.
- **Security fix found by those tests:** when the email provider failed, "forgot password" gave an error for real
  accounts and the normal answer for unknown emails, revealing which emails had accounts. It now gives the same
  answer and logs the failure.
- **Versioned test runs:** `npm run test:record` saves each full run with its commit, Node, OS and PostgreSQL versions,
  results per file and coverage, in `backend/test-results/`.
- **Real-device testing:** `docs/evidence/device-tests.md` is the sheet for results from physical phones and other
  browsers.
