/**
 * SPKI DER, standard base64. Empty until the owner generates an Ed25519 keypair
 * offline and pastes only the public key here. Remote configs stay rejected
 * until this is set, and the extension keeps bundled defaults.
 */
const baked = import.meta.env.VITE_CONFIG_PUBLIC_KEY;
export const CONFIG_PUBLIC_KEY_SPKI_B64 = typeof baked === "string" ? baked.trim() : "";
