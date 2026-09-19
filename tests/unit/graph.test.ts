import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it, vi } from "vitest";

import { buildSystemPrompt, createFinanceGraph } from "../../src/graph.js";
import { createFinanceTools } from "../../src/tools.js";

const dataDir = new URL("../../data", import.meta.url).pathname;

const createFakeModel = (responses: AIMessage[]): BaseChatModel => {
  let call = 0;
  return {
    bindTools: () => ({
      invoke: async () => {
        const response = responses[call] ?? new AIMessage("done");
        call += 1;
        return response;
      },
    }),
  } as unknown as BaseChatModel;
};

describe("finance graph", () => {
  it("sets YESTERDAY to the previous calendar day in app timezone", () => {
    const prompt = buildSystemPrompt(dataDir, "UTC", new Date("2026-07-10T15:00:00Z"));
    expect(prompt).toContain("TODAY=2026-07-10");
    expect(prompt).toContain("YESTERDAY=2026-07-09");
  });

  it("runs llm → tools → llm and returns the final AI message", async () => {
    const executeSql = vi.fn().mockResolvedValue([{ id: 1, name: "Coffee", amount: 5 }]);
    const tools = createFinanceTools(executeSql);

    const model = createFakeModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "exec_sql",
            args: { sql: "SELECT id, name, amount FROM public.expense LIMIT 1;" },
            id: "call-1",
            type: "tool_call",
          },
        ],
      }),
      new AIMessage("You spent 5 on Coffee."),
    ]);

    const graph = createFinanceGraph({
      model,
      tools,
      dataDir,
      appTimezone: "UTC",
      maxSteps: 10,
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("latest expenses")],
        stepCount: 0,
      },
      { configurable: { thread_id: "test-1" } },
    );

    expect(result.messages.map((m) => m.getType())).toEqual(
      expect.arrayContaining(["human", "ai", "tool", "ai"]),
    );
    expect(executeSql).toHaveBeenCalledOnce();
    expect(result.messages.at(-1)?.content).toBe("You spent 5 on Coffee.");
    expect(result.stepCount).toBeGreaterThanOrEqual(2);
  });

  it("includes fetch_wise_transactions when Wise is configured", async () => {
    const fetchWise = vi.fn().mockResolvedValue([
      { name: "Uber", amount: "12.5", status: "COMPLETED", createdOn: "2026-07-09T10:00:00Z" },
    ]);
    const tools = createFinanceTools(vi.fn().mockResolvedValue([]), { fetchWise });

    const model = createFakeModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "fetch_wise_transactions",
            args: { since: "2026-07-09", until: "2026-07-10" },
            id: "wise-1",
            type: "tool_call",
          },
        ],
      }),
      new AIMessage("Synced 1 transaction."),
    ]);

    const graph = createFinanceGraph({
      model,
      tools,
      dataDir,
      appTimezone: "UTC",
    });

    const result = await graph.invoke(
      {
        messages: [new HumanMessage("sync wise")],
        stepCount: 0,
      },
      { configurable: { thread_id: "test-2" } },
    );

    expect(fetchWise).toHaveBeenCalledWith({ since: "2026-07-09", until: "2026-07-10" });
    expect(result.messages.at(-1)?.content).toBe("Synced 1 transaction.");
  });
});
