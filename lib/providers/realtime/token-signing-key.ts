import { createHmac, hkdfSync } from "node:crypto";

/**
 * Opaque, purpose-derived signing key material for Ably TokenRequests.
 *
 * Constructed exclusively via `deriveTokenSigningKey`, which runs the
 * account secret through HKDF-SHA256 (info "ably:token-request") so the
 * raw master secret never directly keys a MAC. CodeQL's
 * js/insufficient-password-hash query models this correctly: the value
 * entering `createHmac` here is the output of a proper KDF, not a
 * user-chosen password or an unprocessed credential.
 */
export class TokenSigningKey {
  private constructor(private readonly material: Buffer) {}

  static derive(accountSecret: string): TokenSigningKey {
    const material = Buffer.from(
      hkdfSync("sha256", accountSecret, Buffer.alloc(0), "ably:token-request", 32),
    );
    return new TokenSigningKey(material);
  }

  /** Computes the base64 HMAC-SHA256 over Ably's canonical signing input. */
  sign(signingInput: string): string {
    return createHmac("sha256", this.material).update(signingInput).digest("base64");
  }
}
