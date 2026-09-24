import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { FetchWiseTransactions } from "./integrations/wise.js";
import { normalizeToolOutput, serializeToolResult } from "./utils/exec-sql.js";

const TOOL_OUTPUT_MAX_CHARS = 8_000;

const truncateToolOutput = (output: string, maxChars = TOOL_OUTPUT_MAX_CHARS): string =>
  output.length <= maxChars
    ? output
    : `${output.slice(0, maxChars)}\u2026[truncated, ${output.length - maxChars} chars omitted]`;

export type ExecuteSql = <T = unknown>(sql: string) => Promise<T>;

export type FinanceToolsOptions = {
  fetchWise?: FetchWiseTransactions;
};

export const createFinanceTools = (
  executeSql: ExecuteSql,
  options: FinanceToolsOptions = {},
): StructuredToolInterface[] => {
  const execSql = tool(
    async (input: { sql: string }) => {
      try {
        const result = await executeSql(input.sql);
        const normalizedResult = normalizeToolOutput(result);
        return truncateToolOutput(serializeToolResult(normalizedResult));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: message });
      }
    },
    {
      name: "exec_sql",
      description: "Execute a SQL query against Supabase. Returns rows as JSON.",
      schema: z.object({
        sql: z.string().describe("The SQL query to execute"),
      }),
    },
  );

  const tools: StructuredToolInterface[] = [execSql];

  const fetchWise = options.fetchWise;
  if (!fetchWise) {
    return tools;
  }

  tools.push(
    tool(
      async (input: { since: string; until: string }) => {
        try {
          const transactions = await fetchWise(input);
          const normalizedTransactions = normalizeToolOutput(transactions);
          return truncateToolOutput(serializeToolResult(normalizedTransactions));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return JSON.stringify({ error: message });
        }
      },
      {
        name: "fetch_wise_transactions",
        description: "Fetch transactions from the Wise API for a date range",
        schema: z.object({
          since: z.string().describe("Start date and time 2026-01-01T00:00:00Z (ISO 8601)"),
          until: z.string().describe("End date and time 2026-01-01T23:59:59Z (ISO 8601)"),
        }),
      },
    ),
  );

  return tools;
};
