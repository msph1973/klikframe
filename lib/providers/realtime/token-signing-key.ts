import { createHmac, createHash, hkdfSync } from "node:crypto";

/**
 * Opaque, purpose-derived signing key for Ably TokenRequests.
 *
 * Two-stage derivation: (1) HKDF-SHA256 with info
 * "ably:token-request" extracts a purpose-specific key from the master
 * secret; (2) a SHA-256 digest of that extracted key becomes the final
 * HMAC key. The account secret is therefore never the direct input to
 * any MAC computation.
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
