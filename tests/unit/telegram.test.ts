import { describe, expect, it } from "vitest";
import type { Context } from "telegraf";

import {
  formatTelegramMarkdownV2,
  splitMessage,
  TelegramAdapter,
} from "../../src/telegram.js";

const createAdapter = () =>
  new TelegramAdapter(
    { getGraph: () => ({}) as never },
    {
      telegramBotToken: "token",
      allowedTelegramUserId: "100",
      allowedTelegramChatId: "200",
    },
  );

const createContext = (overrides: {
  userId?: number;
  chatId?: number;
  text?: string;
}): Context =>
  ({
    from: overrides.userId === undefined ? undefined : { id: overrides.userId },
    chat: overrides.chatId === undefined ? undefined : { id: overrides.chatId },
    message:
      overrides.text === undefined
        ? undefined
        : { text: overrides.text },
  }) as Context;

describe("telegram helpers", () => {
  it("escapes MarkdownV2 reserved characters while preserving bold", () => {
    expect(formatTelegramMarkdownV2("a_b **bold**")).toContain("*bold*");
    expect(formatTelegramMarkdownV2("a.b")).toBe("a\\.b");
  });

  it("rejects unauthorized Telegram users and chats", () => {
    const adapter = createAdapter();

    expect(adapter.parseInbound(createContext({ userId: 999, chatId: 200, text: "hi" }))).toBeNull();
    expect(adapter.parseInbound(createContext({ userId: 100, chatId: 201, text: "hi" }))).toBeNull();
    expect(adapter.parseInbound(createContext({ userId: 100, chatId: 200, text: "hi" }))?.content).toBe(
      "hi",
    );
  });

  it("splits long messages on newlines", () => {
    const text = `${"a".repeat(4000)}\n${"b".repeat(4000)}`;
    const chunks = splitMessage(text, 4096);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.length).toBeLessThanOrEqual(4096);
    expect(chunks[1]?.length).toBeLessThanOrEqual(4096);
  });
});
