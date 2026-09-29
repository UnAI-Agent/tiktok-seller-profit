"""Register the owner WebAuthn credential. Run once; there is no prod registration route."""

from __future__ import annotations

import sys


def main() -> None:
    try:
        import webauthn
    except ImportError:
        sys.exit("Install command-center/requirements.txt before registering a key")
    print("Use py_webauthn to store the owner credential, then set WEBAUTHN_REQUIRED=1.")
    print(webauthn.__name__)


if __name__ == "__main__":
    main()
