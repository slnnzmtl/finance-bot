import "dotenv/config";
import path from "node:path";

import { MemorySaver } from "@langchain/langgraph";

import { loadConfig } from "./config.js";
import { createGeminiChatModel } from "./gemini.js";
import { createFinanceGraph, type CompiledFinanceGraph } from "./graph.js";
import { setupSupabaseWriteSession } from "./integrations/supabase.js";
import { createFetchWiseTransactions } from "./integrations/wise.js";
import type { SqlSession } from "./integrations/mcp/sql-session.js";
import { TelegramAdapter } from "./telegram.js";
import { createFinanceTools } from "./tools.js";

export type FinanceBotApp = {
  telegramAdapter: TelegramAdapter;
  sqlSession: SqlSession;
  getGraph: () => CompiledFinanceGraph;
  shutdown: () => Promise<void>;
};

export const createApp = async (): Promise<FinanceBotApp> => {
  const config = loadConfig();
  const dataDir = path.resolve(config.dataDir);

  const sqlSession = await setupSupabaseWriteSession({
    supabaseMcpUrl: config.supabaseMcpUrl,
    supabaseProjectRef: config.supabaseProjectRef,
    supabaseAccessToken: config.supabaseAccessToken,
    mcpMaxReconnectAttempts: config.mcpMaxReconnectAttempts,
    mcpReconnectBaseDelayMs: config.mcpReconnectBaseDelayMs,
    mcpReconnectMaxDelayMs: config.mcpReconnectMaxDelayMs,
  });

  const fetchWise = createFetchWiseTransactions({
    wiseApiToken: config.wiseApiToken,
    wiseProfileId: config.wiseProfileId,
  });

  const tools = createFinanceTools(sqlSession.executeSql.bind(sqlSession), {
    ...(fetchWise ? { fetchWise } : {}),
  });

  const model = createGeminiChatModel(config.googleApiKey, config.financeModel);
  const checkpointer = new MemorySaver();
  const graph = createFinanceGraph({
    model,
    tools,
    dataDir,
    appTimezone: config.appTimezone,
    maxSteps: config.maxSteps,
    checkpointer,
  });

  const telegramAdapter = new TelegramAdapter(
    { getGraph: () => graph },
    {
      telegramBotToken: config.telegramBotToken,
      allowedTelegramUserId: config.allowedTelegramUserId,
      allowedTelegramChatId: config.allowedTelegramChatId,
    },
  );

  return {
    telegramAdapter,
    sqlSession,
    getGraph: () => graph,
    shutdown: async () => {
      await telegramAdapter.stop();
      await sqlSession.close();
    },
  };
};

const main = async (): Promise<void> => {
  const app = await createApp();

  const shutdown = async (): Promise<void> => {
    await app.shutdown();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  console.log("Finance bot starting (Telegram long-polling)...");
  await app.telegramAdapter.launch();
  console.log("Finance bot launched.");
};

main().catch((error: unknown) => {
  console.error("Failed to start finance bot:", error);
  process.exitCode = 1;
});
