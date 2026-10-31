// The tenant assertion carries the claims LPAI checks. That the copied identifiers equal the contract's
// is checked in the service repository, against this package as published.
import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, jwtVerify, importJWK } from "jose";
import * as E from "../src/index.ts";

describe("the tenant assertion", () => {
  it("verifies against the tenant's public key with the claims LPAI checks", async () => {
    const kp = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const priv = await E.importTenantKey(await exportJWK(kp.privateKey));
    const jwt = await E.tenantAssertion({ tenantId: "00000000-0000-4000-8000-0000000000aa", kid: "did:web:x#key-1", privateKey: priv }, "instruction");
    const pub = await importJWK(await exportJWK(kp.publicKey), "EdDSA");
    const { payload, protectedHeader } = await jwtVerify(jwt, pub, { issuer: "00000000-0000-4000-8000-0000000000aa", audience: "lpai-v1", algorithms: ["EdDSA"], maxTokenAge: "60s" });
    expect(protectedHeader).toMatchObject({ alg: "EdDSA", typ: "lpai-assertion+jwt", kid: "did:web:x#key-1" });
    expect(payload.purpose).toBe("instruction"); expect(typeof payload.jti).toBe("string");
  });
});
