import { addDaysToYmd } from "./graph.js";

export type ZonedDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const getZonedParts = (date: Date, timeZone: string): ZonedDateTimeParts => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const zonedLocalToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date => {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcMillis = wanted;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = getZonedParts(new Date(utcMillis), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    utcMillis += wanted - asUtc;
  }

  return new Date(utcMillis);
};

export const nextDailyOccurrence = (
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
): Date => {
  const parts = getZonedParts(now, timeZone);
  let candidate = zonedLocalToUtc(parts.year, parts.month, parts.day, hour, minute, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    const nextDay = addDaysToYmd(`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`, 1);
    const [yearPart, monthPart, dayPart] = nextDay.split("-");
    candidate = zonedLocalToUtc(
      Number.parseInt(yearPart ?? "1970", 10),
      Number.parseInt(monthPart ?? "1", 10),
      Number.parseInt(dayPart ?? "1", 10),
      hour,
      minute,
      timeZone,
    );
  }
  return candidate;
};

export type DailyScheduler = {
  start: () => void;
  stop: () => void;
};

export type CreateDailySchedulerOptions = {
  timezone: string;
  hour: number;
  minute: number;
  run: () => Promise<void>;
  getNow?: () => Date;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
};

export const createDailyScheduler = (options: CreateDailySchedulerOptions): DailyScheduler => {
  const getNow = options.getNow ?? (() => new Date());
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let inFlight = false;

  const arm = (): void => {
    if (stopped) {
      return;
    }
    const now = getNow();
    const next = nextDailyOccurrence(now, options.timezone, options.hour, options.minute);
    const delayMs = Math.max(0, next.getTime() - now.getTime());
    console.log(
      `Finance sync scheduled for ${next.toISOString()} (${options.timezone} ${pad2(options.hour)}:${pad2(options.minute)})`,
    );
    timer = setTimer(() => {
      void (async () => {
        if (stopped) {
          return;
        }
        if (inFlight) {
          console.warn("Skipping overlapping finance sync");
        } else {
          inFlight = true;
          try {
            await options.run();
          } catch (error) {
            console.error("Scheduled finance sync failed:", error);
          } finally {
            inFlight = false;
          }
        }
        arm();
      })();
    }, delayMs);
  };

  return {
    start: () => {
      stopped = false;
      arm();
    },
    stop: () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
    },
  };
};
