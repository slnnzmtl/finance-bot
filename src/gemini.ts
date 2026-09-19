import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const DEFAULT_GEMINI_TEMPERATURE = 0.2;

export const createGeminiChatModel = (
  apiKey: string,
  modelName: string,
  temperature = DEFAULT_GEMINI_TEMPERATURE,
): ChatGoogleGenerativeAI =>
  new ChatGoogleGenerativeAI({
    apiKey,
    model: modelName,
    temperature,
  });
