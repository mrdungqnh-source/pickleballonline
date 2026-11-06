# Courtside Club

Static, dependency-free MVP for the pickleball RPG concept. Open `index.html` directly or publish the repository with GitHub Pages. Demo state is stored in the browser's `localStorage` and is not shared across devices or accounts.

## Technical design

- **Web hosting:** Static HTML/CSS/JavaScript on GitHub Pages. This keeps the player interface deployable without a server or build step.
- **Production data/auth:** Use Supabase Auth + PostgreSQL with Row Level Security. Model player-owned records with `profiles`, `character_stats`, `inventory`, and `tournament_entries`; shared game data with `items`, `tournaments`, `matches`, and `system_configs`; money/points changes with an append-only `wallet_ledger`.
- **Trusted operations:** Route training rewards, level-ups, allocations, item purchases, tournament pairing/results, fatigue, and rewards through database transactions or Edge Functions. Never accept a client-computed CP, wallet balance, role, winner, or reward as authoritative. Keep admin role checks and audit events server-side.
- **Realtime:** Subscribe to narrowly scoped tournament/match records; do not make real-time listeners responsible for validating writes.
- **Payments:** A payment provider webhook must verify its signature and idempotency key before crediting a wallet ledger. The browser only creates a pending top-up intent and displays the provider's QR. Never put webhook secrets in GitHub Pages.
- **Deployment:** A GitHub Actions workflow publishes the static files to Pages on every push to `main`; no build step or package install is required.

## Mechanics represented in the demo

- EXP requirement is `baseExp * level^difficulty`; repeated level-ups grant one skill and one body point each.
- Advanced skills unlock at the configured level (default 40).
- Fatigue is computed from timestamps and resets after the configured recovery interval; no timer process is needed.
- Tournament signup, point allocation, shop purchases, and admin tuning are simulated locally only.

## Important limitations

This is not ready for public competitive play or real-money transactions: it has no authentication, backend, server-side authorization, shared database, anti-cheat, payment provider, or actual tournament engine. The admin screen is intentionally a local configuration demo, not access control. Do not collect real user or payment data with this version.

## Publish

1. Push these files to the repository's `main` branch.
2. In repository Settings > Pages, select **GitHub Actions** as the deployment source.
3. Use the Pages URL shown in the completed `Deploy to GitHub Pages` workflow.