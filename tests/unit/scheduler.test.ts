import { afterEach, describe, expect, it, vi } from "vitest";

import { createDailyScheduler, nextDailyOccurrence } from "../../src/scheduler.js";

describe("nextDailyOccurrence", () => {
  it("uses today's slot when it is still in the future in the timezone", () => {
    const now = new Date("2026-09-20T00:00:00Z"); // 07:00 in Asia/Bangkok
    const next = nextDailyOccurrence(now, "Asia/Bangkok", 8, 0);
    expect(next.toISOString()).toBe("2026-09-20T01:00:00.000Z");
  });

  it("rolls to the next calendar day after the daily slot has passed", () => {
    const now = new Date("2026-09-20T02:00:00Z"); // 09:00 in Asia/Bangkok
    const next = nextDailyOccurrence(now, "Asia/Bangkok", 8, 0);
    expect(next.toISOString()).toBe("2026-09-21T01:00:00.000Z");
  });
});

describe("createDailyScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once at the next daily slot and reschedules", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T07:59:00Z"));
    const run = vi.fn().mockResolvedValue(undefined);

    const scheduler = createDailyScheduler({
      timezone: "UTC",
      hour: 8,
      minute: 0,
      run,
    });

    scheduler.start();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });
});
