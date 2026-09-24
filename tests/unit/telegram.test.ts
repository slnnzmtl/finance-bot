import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { Context } from "telegraf";
import type { Telegraf } from "telegraf";

import {
  FINANCE_SYNC_PROMPT,
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

  it("runs scheduled Wise sync on the allowed chat and sends the graph reply", async () => {
    const invoke = vi.fn().mockResolvedValue({
      messages: [new HumanMessage(FINANCE_SYNC_PROMPT), new AIMessage("Synced 2 expenses for 2026-09-19.")],
    });
    const getState = vi.fn().mockResolvedValue({ values: { messages: [] } });
    const sendMessage = vi.fn().mockResolvedValue({});
    const bot = { telegram: { sendMessage }, stop: vi.fn() } as unknown as Telegraf<Context>;

    const adapter = new TelegramAdapter(
      { getGraph: () => ({ invoke, getState, updateState: vi.fn() }) as never },
      {
        telegramBotToken: "token",
        allowedTelegramUserId: "100",
        allowedTelegramChatId: "200",
      },
      bot,
    );

    await adapter.processScheduledSync();

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.any(HumanMessage)],
      }),
      expect.objectContaining({ configurable: { thread_id: "200" } }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      200,
      expect.stringContaining("Synced 2 expenses"),
      expect.objectContaining({ parse_mode: "MarkdownV2" }),
    );
  });
});
