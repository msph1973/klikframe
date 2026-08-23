// Identifier stoplist for the status-vocabulary check: words that
// legitimately co-occur with a "status" mention in documentation but are
// not DATABASE_SCHEMA.md enum values. Keeping this separate from
// section8-rules.mjs keeps both files within the 400-line review target.

/**
 * Backticked lowercase snake_case tokens that must never be flagged as
 * unknown statuses even though they appear near the word "status".
 */
export const STATUS_STOPWORDS = new Set([
  // Infrastructure/identifier words that co-occur with "status" but are not statuses.
  "api", "auth", "json", "uuid", "http", "https", "url", "id", "ids", "key", "keys",
  "token", "tokens", "scope", "scopes", "route", "routes", "file", "files", "test",
  "tests", "code", "data", "env", "var", "vars", "log", "logs", "etag", "cookie",
  "cookies", "header", "headers", "body", "error", "errors", "client", "owner",
  "portal", "cron", "email", "phone", "name", "note", "notes", "type", "types",
  "workspace", "workspaces", "review", "reviews", "state", "states", "field",
  "fields", "value", "values", "row", "rows", "column", "columns", "enum",
  "enums", "check", "checks", "gate", "gates", "policy", "policies", "model",
  "models", "schema", "schemas", "table", "tables", "request",
  "requests", "response", "responses", "audit", "audits", "event", "events",
  // DATABASE_SCHEMA.md table names that carry a `status` column; mentions
  // of the table itself are not status tokens.
  "idempotency_requests",
  "notification_deliveries",
]);
