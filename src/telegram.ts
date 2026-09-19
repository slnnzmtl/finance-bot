import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { GraphRecursionError } from "@langchain/langgraph";
import { Telegraf, type Context } from "telegraf";

import type { CompiledFinanceGraph } from "./graph.js";

export type TelegramConfig = {
  telegramBotToken: string;
  allowedTelegramUserId: string;
  allowedTelegramChatId: string;
};

export type WorkflowGraphSource = {
  getGraph(): CompiledFinanceGraph;
};

const TELEGRAM_MARKDOWN_V2_RESERVED_CHARACTERS = /[\\_*\[\]()~`>#+\-=|{}.!]/g;

const escapeTelegramMarkdownV2Text = (text: string): string =>
  text.replace(TELEGRAM_MARKDOWN_V2_RESERVED_CHARACTERS, "\\$&");

const escapeTelegramMarkdownV2Url = (text: string): string => text.replace(/[\\)]/g, "\\$&");

export const formatTelegramMarkdownV2 = (text: string): string => {
  const tokens: string[] = [];
  const createToken = (value: string): string => {
    tokens.push(value);
    return `\u0000${tokens.length - 1}\u0000`;
  };

  const withTokens = text
    .replace(/\*\*(.+?)\*\*/g, (_match, boldText: string) => createToken(`*${escapeTelegramMarkdownV2Text(boldText)}*`))
    .replace(/\[((?:\\.|[^\]])+?)\]\(((?:\\.|[^)])+?)\)/g, (_match, linkText: string, url: string) =>
      createToken(`[${escapeTelegramMarkdownV2Text(linkText)}](${escapeTelegramMarkdownV2Url(url)})`),
    );

  const escapedText = escapeTelegramMarkdownV2Text(withTokens);
  return escapedText.replace(/\u0000(\d+)\u0000/g, (_match, tokenIndex: string) => tokens[Number(tokenIndex)] ?? "");
};

export const splitMessage = (text: string, maxLength = 4096): string[] => {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split("\n");
  let currentChunk = "";

  for (const line of lines) {
    if (line.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
      continue;
    }

    const testChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    if (testChunk.length <= maxLength) {
      currentChunk = testChunk;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
};

export const extractTelegramMessageText = (content: BaseMessage["content"]): string => {
  if (typeof content === "string") {
    return content.replaceAll("\\n", "\n");
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part.type === "text") {
          return part.text;
        }
        return "[non-text content omitted]";
      })
      .join("\n")
      .replaceAll("\\n", "\n");
  }

  return JSON.stringify(content);
};

const truncateForLog = (value: string, maxLength = 500): string =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

const logTelegramMessage = (role: "user" | "bot", text: string): void => {
  console.log(`${role}: ${truncateForLog(text)}`);
};

const sendChunk = async (telegram: Context["telegram"], chatId: number, chunk: string): Promise<void> => {
  try {
    await telegram.sendMessage(chatId, formatTelegramMarkdownV2(chunk), { parse_mode: "MarkdownV2" });
  } catch (error) {
    const isParseError = error instanceof Error && error.message.includes("can't parse entities");
    if (isParseError) {
      await telegram.sendMessage(chatId, chunk);
    } else {
      throw error;
    }
  }
};

const MAX_TRACKED_UPDATE_IDS = 1_000;
const MAX_CHECKPOINT_MESSAGES = 40;

export class TelegramAdapter {
  private readonly bot: Telegraf<Context>;
  private readonly allowedTelegramUserId: string;
  private readonly allowedTelegramChatId: string;
  private readonly processedUpdateIds = new Set<number>();
  private readonly threadQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly graphSource: WorkflowGraphSource,
    config: TelegramConfig,
    bot?: Telegraf<Context>,
  ) {
    this.bot = bot ?? new Telegraf(config.telegramBotToken);
    this.allowedTelegramUserId = config.allowedTelegramUserId;
    this.allowedTelegramChatId = config.allowedTelegramChatId;
  }

  markUpdateProcessed(updateId: number): boolean {
    if (this.processedUpdateIds.has(updateId)) {
      return false;
    }

    this.processedUpdateIds.add(updateId);

    if (this.processedUpdateIds.size > MAX_TRACKED_UPDATE_IDS) {
      const oldest = this.processedUpdateIds.values().next().value;
      if (oldest !== undefined) {
        this.processedUpdateIds.delete(oldest);
      }
    }

    return true;
  }

  runExclusiveForThread(threadId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.threadQueues.get(threadId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.threadQueues.set(
      threadId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  parseInbound(ctx: Context): HumanMessage | null {
    if (ctx.from?.id.toString() !== this.allowedTelegramUserId) {
      console.warn(`Unauthorized access attempt from Telegram ID: ${ctx.from?.id}`);
      return null;
    }

    if (ctx.chat?.id?.toString() !== this.allowedTelegramChatId) {
      console.warn(`Unauthorized access attempt from Telegram chat ID: ${ctx.chat?.id}`);
      return null;
    }

    if (ctx.message && "text" in ctx.message && typeof ctx.message.text === "string") {
      return new HumanMessage(ctx.message.text);
    }

    return null;
  }

  async triggerWorkflow(message: HumanMessage, threadId: string) {
    const graph = this.graphSource.getGraph();
    const invokeConfig = {
      configurable: { thread_id: threadId },
      recursionLimit: 40,
    };

    const snapshot = await graph.getState(invokeConfig);
    const existingMessages = snapshot.values.messages;
    if (Array.isArray(existingMessages) && existingMessages.length > MAX_CHECKPOINT_MESSAGES) {
      await graph.updateState(invokeConfig, {
        messages: existingMessages.slice(-MAX_CHECKPOINT_MESSAGES),
      });
    }

    return graph.invoke({ messages: [message], stepCount: 0 }, invokeConfig);
  }

  async sendOutbound(ctx: Context, stateMessages: BaseMessage[]): Promise<void> {
    const lastMessage = stateMessages[stateMessages.length - 1];
    const chatId = ctx.chat?.id;

    if (!chatId) {
      console.error("Unable to determine chat ID for outbound message.");
      return;
    }

    if (!lastMessage) {
      await ctx.telegram.sendMessage(chatId, "System Error: No response was produced.");
      return;
    }

    const output = extractTelegramMessageText(lastMessage.content).trim();

    if (!output) {
      await ctx.telegram.sendMessage(chatId, "System Error: Empty response from agent.");
      return;
    }

    logTelegramMessage("bot", output);

    for (const chunk of splitMessage(output)) {
      await sendChunk(ctx.telegram, chatId, chunk);
    }
  }

  async processInboundMessage(ctx: Context, inboundMessage: HumanMessage): Promise<void> {
    const threadId = ctx.chat?.id?.toString();

    if (!threadId) {
      console.error("Unable to determine Telegram chat ID for incoming message.");
      return;
    }

    logTelegramMessage("user", extractTelegramMessageText(inboundMessage.content));

    await this.runExclusiveForThread(threadId, async () => {
      try {
        await ctx.sendChatAction("typing");
        const finalState = await this.triggerWorkflow(inboundMessage, threadId);
        await this.sendOutbound(ctx, finalState.messages);
      } catch (error) {
        if (error instanceof GraphRecursionError) {
          console.error("Agent recursion limit reached:", error);
          await ctx.telegram.sendMessage(
            ctx.chat!.id,
            "I got stuck in a loop on that request. Please try rephrasing or try again.",
          );
        } else {
          console.error("Agent execution error:", error);
          await ctx.telegram.sendMessage(ctx.chat!.id, "System Error: Unable to process request.");
        }
      }
    });
  }

  async handleMessage(ctx: Context): Promise<void> {
    const updateId = ctx.update.update_id;
    if (!this.markUpdateProcessed(updateId)) {
      console.warn(`Skipping duplicate Telegram update: ${updateId}`);
      return;
    }

    const inboundMessage = this.parseInbound(ctx);
    if (!inboundMessage) {
      return;
    }

    await this.processInboundMessage(ctx, inboundMessage);
  }

  async launch(): Promise<void> {
    this.bot.on("message", async (ctx) => {
      await this.handleMessage(ctx);
    });

    await this.bot.launch();
  }

  async stop(): Promise<void> {
    this.bot.stop("shutdown");
  }
}
