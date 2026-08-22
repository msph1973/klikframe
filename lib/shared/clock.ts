/**
 * Frozen clock port. Domain/service code MUST depend on this instead of
 * calling `Date.now()`/`new Date()` directly so tests can inject
 * deterministic time (TESTING.md §2.1: "fake clock/UUID").
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  private readonly fixedMillis: number;

  constructor(fixed: Date) {
    this.fixedMillis = fixed.getTime();
  }

  now(): Date {
    return new Date(this.fixedMillis);
  }
}
