import { createHmac, randomUUID } from "node:crypto";

/**
 * Signs Ably TokenRequests with the account key secret exactly as Ably's
 * protocol mandates (HMAC-SHA256 over the canonical signing input; see
 * ably.com/docs/api/token-request-spec). The secret is an opaque
 * credential held server-only and never leaves this module.
 *
 * CodeQL note: `createHmac` here implements a wire-protocol MAC required
 * by the Ably TokenRequest spec — it is not password storage, so
 * js/insufficient-password-hash is addressed via a targeted query
 * exclusion in codeql-config.yml rather than by altering the protocol.
 */
export function signTokenRequestMac(
  keySecret: string,
  signingInput: string,
): string {
  return createHmac("sha256", Buffer.from(keySecret, "utf8"))
    .update(signingInput)
    .digest("base64");
}

export function generateNonce(): string {
  return randomUUID();
}
