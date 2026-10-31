// A tenant assertion for LPAI's native endpoints (/v1/events, /v1/admin/provision): an EdDSA
// (Ed25519) JWT the tenant signs with its registered key, single-use (a fresh jti each call) and
// short-lived. WebCrypto only, so the package keeps no dependencies.
export interface TenantKey { tenantId: string; kid: string; privateKey: CryptoKey }
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
export async function tenantAssertion(key: TenantKey, purpose: string, subject = "lms", lifetimeSeconds = 45): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "EdDSA", typ: "lpai-assertion+jwt", kid: key.kid });
  const body = enc({ iss: key.tenantId, aud: "lpai-v1", sub: subject, jti: crypto.randomUUID(), iat: now, exp: now + Math.min(60, lifetimeSeconds), purpose });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
/** Import a tenant's private key from its JWK (the file the sandbox script writes). */
export async function importTenantKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
}
