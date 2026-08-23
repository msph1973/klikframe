/**
 * Provider boundary barrel (ARCHITECTURE.md §3.4–3.8). Re-exports the
 * ports, adapters, and composition helpers; vendor SDKs stay behind this
 * module — application code never imports @aws-sdk/*, jose wire types, or
 * provider HTTP shapes directly.
 */
export type {
  RateLimitFailure,
  RateLimitResult,
  RateLimitSuccess,
  RateLimiter,
  RateLimitWindow,
} from "./upstash/rate-limit-port";
export { FakeRateLimiter } from "./upstash/fake-rate-limiter";
export { UpstashRestRateLimiter } from "./upstash/upstash-rate-limiter";
export { FIXED_WINDOW_MULTI_LUA, UPSTASH_SCRIPT_KEYS } from "./upstash/fixed-window-lua";

export type {
  ObjectStorage,
  PresignDownloadRequest,
  PresignUploadRequest,
  StoragePurpose,
} from "./storage/storage-port";
export { STORAGE_PURPOSES, storageKeyPrefix } from "./storage/storage-port";
export type {
  DeleteOutcome,
  HeadOutcome,
  PresignDownloadOutcome,
  PresignUploadOutcome,
  StorageOperation,
} from "./storage/storage-types";
export { FakeObjectStorage } from "./storage/fake-object-storage";
export { CivoS3Storage } from "./storage/civo-s3-storage";

export type {
  EmailDeliveryRecord,
  EmailKind,
  EmailSender,
  SendEmailRequest,
} from "./email/email-port";
export { EMAIL_KINDS } from "./email/email-port";
export { FakeEmailSender } from "./email/fake-email-sender";
export { ResendEmailSender } from "./email/resend-email-sender";

export { AblyRestPublisher, AblyTokenIssuer } from "./realtime/ably-adapter";
export type { AblyAdapterOptions } from "./realtime/ably-adapter";
export {
  FakeRealtimePublisher,
  FakeRealtimeTokenIssuer,
} from "./realtime/fake-realtime";

export {
  getProviders,
  resetProvidersForTests,
  wireIdentitySessionPort,
} from "./composition";
export type { ProviderSet } from "./composition";
