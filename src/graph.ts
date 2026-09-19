import { readFileSync } from "node:fs";
import path from "node:path";

import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { Annotation, END, MemorySaver, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

export const MAX_STEPS_DEFAULT = 10;

export const FinanceStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  stepCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
});

export type FinanceState = typeof FinanceStateAnnotation.State;

const findLastAIMessage = (messages: BaseMessage[]): AIMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof AIMessage) {
      return message;
    }
  }
  return undefined;
};

export const hasPendingToolCalls = (messages: BaseMessage[]): boolean => {
  const aiMessage = findLastAIMessage(messages);
  const toolCalls = aiMessage?.tool_calls;

  if (!toolCalls?.length) {
    return false;
  }

  const fulfilledIds = new Set(
    messages
      .filter((message): message is ToolMessage => message instanceof ToolMessage)
      .map((message) => message.tool_call_id)
      .filter(Boolean),
  );

  return toolCalls.some((call) => !call.id || !fulfilledIds.has(call.id));
};

export const lastMessageRequestsTools = (messages: BaseMessage[]): boolean => {
  const lastMessage = messages[messages.length - 1];
  if (!(lastMessage instanceof AIMessage)) {
    return false;
  }
  return (lastMessage.tool_calls?.length ?? 0) > 0;
};

const formatDateInTimezone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
};

/** Previous calendar day for a YYYY-MM-DD string (UTC date arithmetic). */
export const addDaysToYmd = (ymd: string, deltaDays: number): string => {
  const [yearPart, monthPart, dayPart] = ymd.split("-");
  const year = Number.parseInt(yearPart ?? "", 10);
  const month = Number.parseInt(monthPart ?? "", 10);
  const day = Number.parseInt(dayPart ?? "", 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const buildSystemPrompt = (dataDir: string, appTimezone: string, now = new Date()): string => {
  const promptPath = path.resolve(dataDir, "prompt.md");
  const ledgerPath = path.resolve(dataDir, "ledger.json");
  const prompt = readFileSync(promptPath, "utf8").trim();
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown;
  const today = formatDateInTimezone(now, appTimezone);
  const yesterday = addDaysToYmd(today, -1);

  return [
    prompt,
    "",
    "## Ledger metadata",
    "```json",
    JSON.stringify(ledger, null, 2),
    "```",
    "",
    `TODAY=${today}`,
    `YESTERDAY=${yesterday}`,
    `TIMEZONE=${appTimezone}`,
  ].join("\n");
};

export type CreateFinanceGraphOptions = {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  dataDir: string;
  appTimezone: string;
  maxSteps?: number;
  checkpointer?: MemorySaver;
};

export const createFinanceGraph = (options: CreateFinanceGraphOptions) => {
  const maxSteps = options.maxSteps ?? MAX_STEPS_DEFAULT;
  const tools = options.tools;
  const toolNode = new ToolNode(tools);
  const modelWithTools =
    typeof options.model.bindTools === "function"
      ? options.model.bindTools(tools)
      : options.model;

  const llmNode = async (state: FinanceState): Promise<Partial<FinanceState>> => {
    if (hasPendingToolCalls(state.messages)) {
      return { stepCount: state.stepCount };
    }

    const systemPrompt = buildSystemPrompt(options.dataDir, options.appTimezone);
    const response = await modelWithTools.invoke([
      new SystemMessage(systemPrompt),
      ...state.messages,
    ]);

    return {
      messages: [response as BaseMessage],
      stepCount: state.stepCount + 1,
    };
  };

  const toolsNode = async (state: FinanceState): Promise<Partial<FinanceState>> => {
    const result = await toolNode.invoke({ messages: state.messages });
    return { messages: result.messages };
  };

  const graph = new StateGraph(FinanceStateAnnotation)
    .addNode("llm", llmNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "llm")
    .addConditionalEdges("llm", (state: FinanceState) => {
      if (state.stepCount >= maxSteps) {
        return END;
      }
      if (hasPendingToolCalls(state.messages) || lastMessageRequestsTools(state.messages)) {
        return "tools";
      }
      return END;
    })
    .addConditionalEdges("tools", (state: FinanceState) => {
      if (state.stepCount >= maxSteps) {
        return END;
      }
      if (hasPendingToolCalls(state.messages)) {
        return "tools";
      }
      return "llm";
    });

  return graph.compile({
    name: "finance-bot",
    checkpointer: options.checkpointer ?? new MemorySaver(),
  });
};

export type CompiledFinanceGraph = ReturnType<typeof createFinanceGraph>;
