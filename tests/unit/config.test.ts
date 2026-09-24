import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, parseFinanceSyncAt } from "../../src/config.js";

const REQUIRED_ENV = {
  TELEGRAM_BOT_TOKEN: "bot-token",
  ALLOWED_TELEGRAM_USER_ID: "100",
  GOOGLE_API_KEY: "google-key",
  SUPABASE_PROJECT_REF: "project",
  SUPABASE_ACCESS_TOKEN: "supabase-token",
} as const;

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("treats blank ALLOWED_TELEGRAM_CHAT_ID as allowed user id", () => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
      ALLOWED_TELEGRAM_CHAT_ID: "   ",
    };

    const config = loadConfig();
    expect(config.allowedTelegramChatId).toBe("100");
  });

  it("enables daily finance sync by default only when Wise is configured", () => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
    };
    delete process.env.WISE_API_TOKEN;
    delete process.env.WISE_PROFILE_ID;
    delete process.env.FINANCE_SYNC_ENABLED;

    expect(loadConfig().financeSyncEnabled).toBe(false);

    process.env.WISE_API_TOKEN = "wise-token";
    process.env.WISE_PROFILE_ID = "wise-profile";
    expect(loadConfig().financeSyncEnabled).toBe(true);
    expect(loadConfig().financeSyncHour).toBe(8);
    expect(loadConfig().financeSyncMinute).toBe(0);
  });

  it("parses FINANCE_SYNC_AT and falls back on invalid values", () => {
    expect(parseFinanceSyncAt("21:30")).toEqual({ hour: 21, minute: 30 });
    expect(parseFinanceSyncAt("9:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseFinanceSyncAt("24:00")).toEqual({ hour: 8, minute: 0 });
    expect(parseFinanceSyncAt(undefined)).toEqual({ hour: 8, minute: 0 });
  });
});
