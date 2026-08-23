/**
 * Atomic multi-key fixed-window counter script shared by the Upstash REST
 * adapter and its contract tests. Mirrors @upstash/ratelimit's fixed-window
 * algorithm, extended to N windows in ONE invocation so a caller modeling
 * SECURITY.md §6's compound limits (e.g. portal resolve: per-IP + per-token)
 * gets true atomicity — no check-then-act gap between windows.
 *
 * Contract (identical to `FakeRateLimiter`):
 * - Window index = floor(now / windowSeconds); bucket key `<key>:<index>`.
 * - Every window is INCREMENTED in this one call; no rollback of windows
 *   that passed when another window was already exhausted.
 * - Returns exactly one usage row per input window: <used> (0 when the
 *   window was full and not incremented).
 *
 * KEYS/ARGV layout (numkeys is implicit in the triplet count):
 *   ARGV[1] = now, whole seconds
 *   then per window i: ARGV[2i] = key, ARGV[2i+1] = limit,
 *                      ARGV[2i+2] = window seconds
 */
export const UPSTASH_SCRIPT_KEYS = 0;

export const FIXED_WINDOW_MULTI_LUA = `
local now = tonumber(ARGV[1])
local results = {}
for i = 0, #KEYS - 1 do
  local key = KEYS[i + 1]
  local limit = tonumber(ARGV[2 + i * 3])
  local window_seconds = tonumber(ARGV[3 + i * 3])
  local index = math.floor(now / window_seconds)
  local bucket = key .. ":" .. tostring(index)
  local used = tonumber(redis.call("INCR", bucket))
  if used == 1 then
    redis.call("PEXPIRE", bucket, window_seconds * 2000 + 1000)
  end
  if used > limit then
    redis.call("DECR", bucket)
    table.insert(results, 0)
  else
    table.insert(results, used)
  end
end
return results
`;
