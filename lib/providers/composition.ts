import "server-only";
import { NeonAuthAdapter } from "@/lib/auth/neon-auth-adapter";
import type { IdentitySessionPort } from "@/lib/auth/identity-session-port";
import { setIdentitySessionPort } from "@/lib/auth/server";
import { SystemClock } from "@/lib/shared/clock";
import type { Clock } from "@/lib/shared/clock";
import { getEnv } from "@/lib/config/env";
import { FakeRateLimiter } from "@/lib/providers/upstash/fake-rate-limiter";
import { UpstashRestRateLimiter } from "@/lib/providers/upstash/upstash-rate-limiter";
import type { RateLimiter } from "@/lib/providers/upstash/rate-limit-port";
import { FakeObjectStorage } from "@/lib/providers/storage/fake-object-storage";
import { CivoS3Storage } from "@/lib/providers/storage/civo-s3-storage";
import type { ObjectStorage } from "@/lib/providers/storage/storage-port";
import { FakeEmailSender } from "@/lib/providers/email/fake-email-sender";
import { ResendEmailSender } from "@/lib/providers/email/resend-email-sender";
import type { EmailSender } from "@/lib/providers/email/email-port";
import {
  AblyRestPublisher,
  AblyTokenIssuer,
} from "@/lib/providers/realtime/ably-adapter";
import {
  FakeRealtimePublisher,
  FakeRealtimeTokenIssuer,
} from "@/lib/providers/realtime/fake-realtime";
import type {
  RealtimePublisher,
  RealtimeTokenIssuer,
} from "@/lib/realtime/realtime-port";

/**
 * Provider composition (ARCHITECTURE.md §2 diagram, §3.4–3.8). Chooses real
 * adapters everywhere except `NODE_ENV === "test"`, where deterministic
 * fakes run so unit suites never touch the network (TESTING.md §2.1–2.3).
 *
 * All construction is lazy on first access and cached; adapters read their
 * canonical env through `getEnv()` at construction so a missing variable
 * fails fast with a sanitized `ProviderError` instead of failing
 * mid-request.
 */
export interface ProviderSet {
  readonly clock: Clock;
  readonly rateLimiter: RateLimiter;
  readonly storage: ObjectStorage;
  readonly email: EmailSender;
  readonly realtimePublisher: RealtimePublisher;
  readonly realtimeTokens: RealtimeTokenIssuer;
}

let cached: ProviderSet | undefined;

/** Returns the process-wide provider set, constructing it on first use. */
export function getProviders(): ProviderSet {
  cached ??= buildProviders();
  return cached;
}

function buildProviders(): ProviderSet {
  const clock = new SystemClock();
  if (getEnv().NODE_ENV === "test") {
    return {
      clock,
      rateLimiter: new FakeRateLimiter(clock),
      storage: new FakeObjectStorage(clock),
      email: new FakeEmailSender(clock),
      realtimePublisher: new FakeRealtimePublisher(clock),
      realtimeTokens: new FakeRealtimeTokenIssuer(clock),
    };
  }
  return {
    clock,
    rateLimiter: new UpstashRestRateLimiter(clock),
    storage: new CivoS3Storage({ clock }),
    email: new ResendEmailSender({ clock }),
    realtimePublisher: new AblyRestPublisher({ clock }),
    realtimeTokens: new AblyTokenIssuer({ clock }),
  };
}

/**
 * Wires the Neon Auth adapter into the identity composition point from
 * `lib/auth/server.ts`. Idempotent; called by server entrypoints that need
 * session resolution (`app/api/auth/[...path]/route.ts`, Hono middleware).
 */
export function wireIdentitySessionPort(): void {
  const adapter: IdentitySessionPort = new NeonAuthAdapter();
  setIdentitySessionPort(adapter);
}

/** Test-only: drops the cached provider set so the next access rebuilds. */
export function resetProvidersForTests(): void {
  cached = undefined;
}
