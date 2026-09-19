# VERIFY

```powershell
npm install
npm test
npm run build
```

Load **`dist/`** unpacked in Chrome.

Backend:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python main.py
curl http://127.0.0.1:8000/health
```

Manual: `TESTING.md` (self-test in Settings, `npm run mock:page` on :8765, one Seller Center product).
