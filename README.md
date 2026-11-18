# Stack: poker buy-in tracker

An installable web app (PWA) for running a home poker game from one phone. You can track buy-ins and rebuys, count chips at cash out, and see who pays who with the fewest payments.

- No backend, no accounts, no tracking. Data lives in your browser's localStorage.
- Works offline after the first load.
- Stack only does the math. It never moves money.
- **My bankroll:** each person logs their own sessions on their own phone (buy-in, cash out, hours) and sees their bankroll graph and stats. The data never leaves that phone, and an optional 4-digit PIN locks the screen whenever the app is closed or put in the background.

Tests: `npm test` (Node 18+).
