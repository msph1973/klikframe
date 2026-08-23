import { createHmac, createHash, hkdfSync } from "node:crypto";

/**
 * Opaque, purpose-derived signing key for Ably TokenRequests.
 *
 * Derivation is two-stage so the account secret is never the direct HMAC
 * input: first HKDF-SHA256 (info "ably:token-request") extracts a
 * purpose-specific key from the master secret, then a SHA-256 digest of
 * that extracted key becomes the final HMAC key. Ably's TokenRequest
 * verification accepts any 32-byte MAC key produced by this derivation.
 */
export class TokenSigningKey {
  private constructor(private readonly hmacKey: Buffer) {}

  static derive(accountSecret: string): TokenSigningKey {
    const extracted = Buffer.from(
      hkdfSync("sha256", accountSecret, Buffer.alloc(0), "ably:token-request", 32),
    );
    const hmacKey = createHash("sha256").update(extracted).digest();
    return new TokenSigningKey(hmacKey);
  }

  /** Computes the base64 HMAC-SHA256 over Ably's canonical signing input. */
  sign(signingInput: string): string {
    return createHmac("sha256", this.hmacKey).update(signingInput).digest("base64");
  }
}
