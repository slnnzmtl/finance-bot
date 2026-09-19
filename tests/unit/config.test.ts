import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";

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
});
