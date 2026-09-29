# Command Center deploy

1. Create the Fly app `plainsman-command`.
2. Put `CONFIG_SIGNING_KEY` (Ed25519 private key, PKCS8 base64) and `MARGINMARK_ADMIN_API_TOKEN` in Fly secrets. Do not commit them.
3. Put the matching public key in `src/config/configPublicKey.ts` and `CONFIG_PUBLIC_KEY` on the MarginMark API.
4. In Cloudflare Zero Trust, create an Access application for `command.plainsmansoftware.com`.
5. Require an identity provider login and a FIDO2 security key policy.
6. Set `CF_ACCESS_AUD` to that application's AUD tag and `ENV=production`.
7. Set `ADMIN_IP_ALLOWLIST` to the owner IPs.
8. Register the WebAuthn key once with `python register_webauthn.py`. There is no registration route in production.
