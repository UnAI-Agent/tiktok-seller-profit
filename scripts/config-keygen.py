"""Write an Ed25519 private key outside the repo and print only the public SPKI."""

from __future__ import annotations

import base64
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

REPO = Path(__file__).resolve().parents[1]


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python scripts/config-keygen.py <key-path-outside-repo>", file=sys.stderr)
        sys.exit(2)
    path = Path(sys.argv[1]).expanduser().resolve()
    try:
        path.relative_to(REPO)
    except ValueError:
        inside = False
    else:
        inside = True
    if inside:
        print("Refusing to write the private key inside the repo.", file=sys.stderr)
        sys.exit(2)
    path.parent.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    print(base64.b64encode(public).decode("ascii"))


if __name__ == "__main__":
    main()
