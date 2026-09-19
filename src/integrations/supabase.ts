import { connectSupabaseMcp } from "./mcp/supabase.js";
import { createSelfHealingSqlSession } from "./mcp/self-healing-session.js";
import type { SqlSession } from "./mcp/sql-session.js";

export type SupabaseConfig = {
  supabaseMcpUrl: string;
  supabaseProjectRef: string;
  supabaseAccessToken: string;
  mcpMaxReconnectAttempts: number;
  mcpReconnectBaseDelayMs: number;
  mcpReconnectMaxDelayMs: number;
};

export const setupSupabaseWriteSession = async (
  config: SupabaseConfig,
): Promise<SqlSession> => {
  return createSelfHealingSqlSession({
    connect: () =>
      connectSupabaseMcp({
        url: config.supabaseMcpUrl,
        projectRef: config.supabaseProjectRef,
        accessToken: config.supabaseAccessToken,
        readOnly: false,
      }),
    maxReconnectAttempts: config.mcpMaxReconnectAttempts,
    reconnectBackoff: {
      baseDelayMs: config.mcpReconnectBaseDelayMs,
      maxDelayMs: config.mcpReconnectMaxDelayMs,
    },
    onReconnect: ({ attempt, delayMs, error }) => {
      console.warn(
        `[Finance] Supabase MCP transport error (reconnect attempt ${attempt} after ${delayMs}ms):`,
        error instanceof Error ? error.message : error,
      );
    },
  });
};
