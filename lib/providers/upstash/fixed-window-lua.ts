/**
 * Atomic multi-key fixed-window counter script shared by the Upstash REST
 * adapter and its contract tests. Mirrors @upstash/ratelimit's fixed-window
 * algorithm, extended to N windows in ONE invocation so a caller modeling
 * SECURITY.md §6's compound limits (e.g. portal resolve: per-IP + per-token)
 * gets true atomicity — no check-then-act gap between windows.
 *
 * Contract (identical to `FakeRateLimiter`):
 * - Window index = floor(now / windowSeconds); bucket key `<key>:<index>`.
 * - Every window is INCREMENTED in this one call; a window that is already
 *   full is rolled back to its limit and reported as the sentinel `0`
 *   (a granted row is always >= 1, so 0 is unambiguous).
 * - Returns exactly one usage row per input window in input order:
 *   <used> for granted windows (1..limit), 0 for full windows.
 *
 * KEYS/ARGV layout (the REST adapter passes numkeys=0, so every input
 * arrives as ARGV):
 *   ARGV[1] = now, whole seconds
 *   then per window i (i = 0..N-1):
 *     ARGV[2 + i*3] = key, ARGV[3 + i*3] = limit,
 *     ARGV[4 + i*3] = window seconds
 */
export const UPSTASH_SCRIPT_KEYS = 0;

export const FIXED_WINDOW_MULTI_LUA = `
local now = tonumber(ARGV[1])
local results = {}
local window_count = (#ARGV - 1) / 3
for i = 0, window_count - 1 do
  local key = ARGV[2 + i * 3]
  local limit = tonumber(ARGV[3 + i * 3])
  local window_seconds = tonumber(ARGV[4 + i * 3])
  local index = math.floor(now / window_seconds)
  local bucket = key .. ":" .. tostring(index)
  local used = tonumber(redis.call("INCR", bucket))
  if used == 1 then
    redis.call("PEXPIRE", bucket, window_seconds * 1000 + 1000)
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
