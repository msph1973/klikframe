import { describe, expect, it } from "vitest";
import { FixedClock, SystemClock } from "../../../lib/shared/clock";

describe("SystemClock", () => {
  it("returns the current wall-clock time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});

describe("FixedClock", () => {
  it("always returns the same instant", () => {
    const fixed = new Date("2026-08-20T10:00:00Z");
    const clock = new FixedClock(fixed);
    expect(clock.now().getTime()).toBe(fixed.getTime());
    expect(clock.now().getTime()).toBe(clock.now().getTime());
  });

  it("is immune to mutation of the returned Date instance", () => {
    const fixed = new Date("2026-08-20T10:00:00Z");
    const clock = new FixedClock(fixed);
    const first = clock.now();
    first.setFullYear(1970);
    expect(clock.now().getTime()).toBe(fixed.getTime());
  });
});
