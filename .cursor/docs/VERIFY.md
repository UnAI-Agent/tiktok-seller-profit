# VERIFY

**Proper local run (do this today).** One terminal. Use this repo, not `ChromExtentionProjects\backend`.

```powershell
cd C:\Users\dimar\Desktop\Projects\ChromExtentionProjects\tiktok-seller-profit
.\scripts\dev-up.ps1 -Build
```

Leave that window open. Then Chrome → Extensions → **Reload** (version 1.2.0) → Seller Center **Ctrl+Shift+R** → click the **toolbar** icon.

Expect `/health` `db_path` under **`tiktok-seller-profit\backend`**. On Seller Center, bottom overlay: signed-out login, signed-in **Overview / Products / Settings**. Add products titles must match listing names (not Category/Spotlight chrome). Overlay: `npm run mock:page` → `http://127.0.0.1:8765/mock-tiktok-product-page.html`. Ops: `http://127.0.0.1:8000/ops`.

API-only (no rebuild): `.\scripts\dev-up.ps1`

Tests: `npm run test`, `npm run build`, then `python -m pytest backend` and `python -m pytest command-center` from the repo root. Install Python test dependencies with `python -m pip install -r backend/requirements-dev.txt`. Real-page tests in `src/content/scraper/realFixtures.test.ts` skip until `test-fixtures/real/<name>.html` and `<name>.expected.json` both exist.

Deploy never restarts local + LLE + prod together. Order: `.cursor/docs/DEPLOY.md` — `.\scripts\deploy-lle.ps1` (wait for health) then `.\scripts\build-lle.ps1`. Prod: `.\scripts\promote-prod.ps1` then bump `manifest.json` version and `.\scripts\build-prod.ps1`. Secret scan: `pwsh scripts/check-secrets.ps1 -All`. Once per clone: `.\scripts\setup-git.ps1`.
