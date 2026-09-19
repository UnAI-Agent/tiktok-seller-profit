# DECISIONS

## D01 — This repo is the Git home

Chosen: `tiktok-seller-profit` on GitHub holds the extension at repo root plus `backend/`.
Rejected: leaving the only copy under unversioned `ChromExtentionProjects/extensions/tiktok-seller-tool`.
Why: user cloned an empty GitHub repo specifically to version the TikTok product.

## D02 — Copy shared FastAPI backend as-is

Chosen: copy `main.py` / `db.py` (still has shop-reply and listing-analyzer `SERVICES` blocks).
Rejected: extracting a TikTok-only FastAPI rewrite in the same move.
Why: Pro auth, Stripe, and SKU sync already depend on this file; a rewrite is a separate task.

## D03 — Email JWT instead of Firebase (for now)

Chosen: FastAPI email/password + JWT; SKU cloud via `/skus`.
Rejected: Firebase Auth + Firestore from the Cursor prompt.
Why: already shipped for alpha; Firebase is optional vs the production brief.
