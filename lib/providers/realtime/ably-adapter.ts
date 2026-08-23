import { signTokenRequestMac, generateNonce } from "./token-signing-key";
import { z } from "zod";
import type { Clock } from "@/lib/shared/clock";
import { getEnv } from "@/lib/config/env";
import { ProviderError } from "@/lib/shared/provider-error";
import {
  assertRealtimeTokenTtl,
  deriveChannelName,
  REALTIME_TOKEN_MAX_TTL_MS,
  type RealtimeChannel,
  type RealtimeEventEnvelope,
  type RealtimePublisher,
  type RealtimeTokenCapability,
  type RealtimeTokenIssuer,
} from "@/lib/realtime/realtime-port";

/**
 * Ably adapters for the frozen realtime ports (ARCHITECTURE.md §3.6,
 * SECURITY.md §1.2, API_SPEC.md §9.6).
 *
 * Security invariants enforced here:
 * - `ABLY_API_KEY` (server-only env) never leaves this module; browsers
 *   receive only subscribe-only capabilities ≤15 min.
 * - Every issued capability passes `assertRealtimeTokenTtl` before being
 *   returned (mandatory per the frozen port contract).
 * - Published payloads are the versioned allowlist envelope only — no PII,
 *   nominal amounts, or raw tokens.
 *
 * Raw REST responses enter as `unknown`, are Zod-validated, and all
 * failures map onto the frozen `ProviderError` taxonomy with sanitized
 * messages. Publish failures surface to the caller whose contract is to
 * catch and log them AFTER commit — they never roll back business
 * transactions.
 */
const ablyTokenRequestSchema = z.object({
  keyName: z.string().min(1),
  ttl: z.number().int().positive(),
  capability: z.string().min(2),
  clientId: z.string().optional(),
  timestamp: z.number().int(),
  nonce: z.string().min(1),
  mac: z.string().min(1),
});

export type AblyTokenRequest = z.infer<typeof ablyTokenRequestSchema>;

export interface AblyAdapterOptions {
  readonly clock: Clock;
  /** Test seam: inject a fetch implementation instead of globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** Splits `keyName:keySecret` without ever exposing the secret part. */
function parseAblyApiKey(apiKey: string): { readonly keyName: string; readonly keySecret: string } {
  const separator = apiKey.lastIndexOf(":");
  if (separator <= 0 || separator === apiKey.length - 1) {
    throw new ProviderError(
      "permanent",
      { provider: "ably", operation: "configure" },
      "ABLY_API_KEY must have the <keyName>:<keySecret> shape",
    );
  }
  return { keyName: apiKey.slice(0, separator), keySecret: apiKey.slice(separator + 1) };
}

function requireAblyKey(operation: string): { readonly keyName: string; readonly keySecret: string } {
  const apiKey = getEnv().ABLY_API_KEY;
  if (!apiKey) {
    throw new ProviderError(
      "permanent",
      { provider: "ably", operation },
      "ABLY_API_KEY must be configured for the Ably adapter",
    );
  }
  return parseAblyApiKey(apiKey);
}

function publishError(kind: "retryable" | "permanent" | "timeout"): ProviderError {
  return new ProviderError(
    kind,
    { provider: "ably", operation: "publish" },
    "The realtime provider rejected the publish",
  );
}

/**
 * Publishes the versioned invalidation envelope to every authorized
 * channel via `POST https://rest.ably.io/messages` (Basic auth over TLS
 * with the server-only key). The wire payload is exactly the five
 * allowlisted envelope fields — nothing else.
 */
export class AblyRestPublisher implements RealtimePublisher {
  private readonly clock: Clock;
  private readonly credentials: { readonly keyName: string; readonly keySecret: string };
  private readonly fetchImpl: typeof fetch;

  constructor(options: AblyAdapterOptions) {
    this.clock = options.clock;
    this.credentials = requireAblyKey("publish");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Kept for symmetry with the token issuer (single clock source). */
  now(): Date {
    return this.clock.now();
  }

  async publish(envelope: RealtimeEventEnvelope, channels: readonly RealtimeChannel[]): Promise<void> {
    if (channels.length === 0) {
      throw publishError("permanent");
    }
    const payload = {
      event_id: envelope.eventId,
      schema_version: envelope.schemaVersion,
      event_type: envelope.eventType,
      resource: { type: envelope.resource.type, id: envelope.resource.id },
      occurred_at: envelope.occurredAt,
    };
    const messages = channels.map((channel) => ({
      channel: deriveChannelName(channel),
      name: "invalidate",
      data: payload,
    }));

    let response: Response;
    try {
      response = await this.fetchImpl("https://rest.ably.io/messages", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.credentials.keyName}:${this.credentials.keySecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });
    } catch {
      throw publishError("retryable");
    }
    if (!response.ok) {
      throw publishError(response.status >= 500 ? "retryable" : "permanent");
    }
  }
}

/**
 * Issues subscribe-only capabilities backed by a real Ably TokenRequest
 * (HMAC-signed, ≤15 min TTL). The browser redeems it against Ably directly;
 * the key secret never travels to any client.
 */
export class AblyTokenIssuer implements RealtimeTokenIssuer {
  private readonly clock: Clock;
  private readonly credentials: { readonly keyName: string; readonly keySecret: string };

  constructor(options: Pick<AblyAdapterOptions, "clock">) {
    this.clock = options.clock;
    this.credentials = requireAblyKey("token");
  }

  async issueCapability(channel: RealtimeChannel): Promise<RealtimeTokenCapability & { tokenRequest: AblyTokenRequest }> {
    await Promise.resolve();
    const channelName = deriveChannelName(channel);
    const issuedAtMs = this.clock.now().getTime();
    // Exactly at the cap: within (0, MAX_TTL] as the runtime guard demands.
    const expiresAt = new Date(issuedAtMs + REALTIME_TOKEN_MAX_TTL_MS);
    // Mandatory runtime guard before returning any capability (frozen port).
    assertRealtimeTokenTtl(this.clock, expiresAt);

    return {
      channel: channelName,
      expiresAt,
      subscribeOnly: true,
      tokenRequest: this.signTokenRequest(channelName, expiresAt.getTime()),
    };
  }

  /**
   * Builds the HMAC-SHA256 TokenRequest signature over the canonical Ably
   * signing input (`keyName\nttl\ncapability\nclientId\ntimestamp\nnonce`).
   * Capability is subscribe-only for the exact derived channel.
   */
  private signTokenRequest(channelName: string, expiresAtMs: number): AblyTokenRequest {
    // Ably TokenRequest wire contract: `ttl` and `timestamp` are
    // MILLISECONDS; the canonical fields are `ttl` + `capability`
    // (clientId optional/empty here). The MAC covers the identical
    // signing input the Ably server recomputes.
    const ttlMs = Math.max(1, expiresAtMs - this.clock.now().getTime());
    const timestamp = this.clock.now().getTime();
    const capability = JSON.stringify({ [channelName]: ["subscribe"] });
    const nonce = generateNonce();
    const signingInput = [this.credentials.keyName, String(ttlMs), capability, "", String(timestamp), nonce].join("\n");
    const tokenRequest: AblyTokenRequest = {
      keyName: this.credentials.keyName,
      ttl: ttlMs,
      capability,
      timestamp,
      nonce,
      mac: signTokenRequestMac(this.credentials.keySecret, signingInput),
    };
    const shaped = ablyTokenRequestSchema.safeParse(tokenRequest);
    if (!shaped.success) {
      throw new ProviderError(
        "permanent",
        { provider: "ably", operation: "token" },
        "The realtime provider produced an unusable token request",
      );
    }
    return tokenRequest;
  }
}
