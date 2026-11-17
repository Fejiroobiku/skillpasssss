# Physical device and browser tests

The performance figures in the report (for example 2.54 s to verify a credential) come from Chrome DevTools
throttling, which only *simulates* a slow phone. This file records tests on **real phones and real browsers**.
Fill in one row per test, only for tests that were actually done, and keep a screenshot or screen recording of each
in `docs/evidence/devices/` with the file name given in the last column.

## How to run each test

1. Turn off Wi-Fi on the phone and use mobile data, so the network is real.
2. Clear the browser's data for skillpasssss.vercel.app, so the page loads cold.
3. Open the API first (https://skillpass-api-3i7w.onrender.com/api/health or any page) and wait until it answers, so
   Render's free-plan wake-up time is not counted.
4. Open the verification page for a known credential and time from tapping the link until the skill, artisan and
   status are visible. Repeat three times and write down the middle time.
5. Then go through: sign in, open the passport, switch to Naija Pidgin, open the QR code, and (assessor) start the
   camera on the Issue Credential page. Note anything that does not work or does not fit the screen.

## Results

| Date | Device (model) | OS version | Browser and version | Network (e.g. MTN 4G, 2 bars) | Verify page ready (s, median of 3) | Sign-in, passport, Pidgin, QR, camera | Problems seen | Evidence file |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Browsers still to check

Chrome on Android, Opera Mini on Android, Samsung Internet, Safari on iPhone, Firefox on desktop, Edge on desktop.
