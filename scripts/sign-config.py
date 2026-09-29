"""Sign a remote-config JSON file. The private key path is never printed."""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from cryptography.hazmat.primitives.serialization import load_pem_private_key

from remote_doc import canonical_body


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/sign-config.py <in.json> <key-path>", file=sys.stderr)
        sys.exit(2)
    doc = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    doc.pop("signature", None)
    key = load_pem_private_key(Path(sys.argv[2]).read_bytes(), password=None)
    doc["signature"] = base64.b64encode(key.sign(canonical_body(doc))).decode("ascii")
    sys.stdout.write(json.dumps(doc, ensure_ascii=False))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
