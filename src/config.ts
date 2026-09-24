const DEFAULT_APP_TIMEZONE = "UTC";
const DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS = 1;
const DEFAULT_MCP_RECONNECT_BASE_DELAY_MS = 0;
const DEFAULT_MCP_RECONNECT_MAX_DELAY_MS = 5_000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_FINANCE_SYNC_HOUR = 8;
const DEFAULT_FINANCE_SYNC_MINUTE = 0;

const REQUIRED_ENV_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "ALLOWED_TELEGRAM_USER_ID",
  "GOOGLE_API_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export type AppConfig = {
  telegramBotToken: string;
  allowedTelegramUserId: string;
  allowedTelegramChatId: string;
  googleApiKey: string;
  financeModel: string;
  appTimezone: string;
  supabaseMcpUrl: string;
  supabaseProjectRef: string;
  supabaseAccessToken: string;
  mcpMaxReconnectAttempts: number;
  mcpReconnectBaseDelayMs: number;
  mcpReconnectMaxDelayMs: number;
  wiseApiToken?: string | undefined;
  wiseProfileId?: string | undefined;
  financeSyncEnabled: boolean;
  financeSyncHour: number;
  financeSyncMinute: number;
  maxSteps: number;
  dataDir: string;
};

const getRequiredEnv = (name: RequiredEnvVar): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const parseNonNegativeInt = (raw: string | undefined, defaultValue: number): number => {
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
};

const normalizeMcpReconnectDelays = (
  baseDelayMs: number,
  maxDelayMs: number,
): { baseDelayMs: number; maxDelayMs: number } => ({
  baseDelayMs,
  maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
});

const parseBooleanEnv = (raw: string | undefined, defaultValue: boolean): boolean => {
  if (!raw) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
};

export const parseFinanceSyncAt = (
  value: string | undefined,
): { hour: number; minute: number } => {
  const match = value?.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return { hour: DEFAULT_FINANCE_SYNC_HOUR, minute: DEFAULT_FINANCE_SYNC_MINUTE };
  }
  return {
    hour: Number.parseInt(match[1] ?? "", 10),
    minute: Number.parseInt(match[2] ?? "", 10),
  };
};

export const normalizeAppTimezone = (value: string | undefined): string => {
  const candidate = value?.trim();
  if (!candidate) {
    return DEFAULT_APP_TIMEZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_APP_TIMEZONE;
  }
};

export const loadConfig = (): AppConfig => {
  const mcpReconnectBaseDelayMs = parseNonNegativeInt(
    process.env.MCP_RECONNECT_BASE_DELAY_MS,
    DEFAULT_MCP_RECONNECT_BASE_DELAY_MS,
  );
  const mcpReconnectMaxDelayMs = parseNonNegativeInt(
    process.env.MCP_RECONNECT_MAX_DELAY_MS,
    DEFAULT_MCP_RECONNECT_MAX_DELAY_MS,
  );
  const normalized = normalizeMcpReconnectDelays(mcpReconnectBaseDelayMs, mcpReconnectMaxDelayMs);
  const allowedTelegramUserId = getRequiredEnv("ALLOWED_TELEGRAM_USER_ID");
  const allowedTelegramChatId = process.env.ALLOWED_TELEGRAM_CHAT_ID?.trim() || allowedTelegramUserId;
  const wiseApiToken = process.env.WISE_API_TOKEN;
  const wiseProfileId = process.env.WISE_PROFILE_ID;
  const wiseConfigured = Boolean(wiseApiToken && wiseProfileId);
  const financeSyncAt = parseFinanceSyncAt(process.env.FINANCE_SYNC_AT);

  return {
    telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
    allowedTelegramUserId,
    allowedTelegramChatId,
    googleApiKey: getRequiredEnv("GOOGLE_API_KEY"),
    financeModel: process.env.FINANCE_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    appTimezone: normalizeAppTimezone(process.env.APP_TIMEZONE),
    supabaseMcpUrl: process.env.SUPABASE_MCP_URL ?? "https://mcp.supabase.com/mcp",
    supabaseProjectRef: getRequiredEnv("SUPABASE_PROJECT_REF"),
    supabaseAccessToken: getRequiredEnv("SUPABASE_ACCESS_TOKEN"),
    mcpMaxReconnectAttempts: parseNonNegativeInt(
      process.env.MCP_MAX_RECONNECT_ATTEMPTS,
      DEFAULT_MCP_MAX_RECONNECT_ATTEMPTS,
    ),
    mcpReconnectBaseDelayMs: normalized.baseDelayMs,
    mcpReconnectMaxDelayMs: normalized.maxDelayMs,
    wiseApiToken,
    wiseProfileId,
    financeSyncEnabled: parseBooleanEnv(process.env.FINANCE_SYNC_ENABLED, wiseConfigured),
    financeSyncHour: financeSyncAt.hour,
    financeSyncMinute: financeSyncAt.minute,
    maxSteps: 10,
    dataDir: process.env.DATA_DIR ?? "data",
  };
};
