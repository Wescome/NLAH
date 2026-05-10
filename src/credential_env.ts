import type { AdapterEnv } from "./adapters.js";

const credentialEnvNames = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "XAI_API_KEY",
  "OFOX_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "MISTRAL_API_KEY",
  "MINIMAX_API_KEY",
  "OPENCODE_API_KEY",
  "KIMI_API_KEY",
  "AWS_BEARER_TOKEN_BEDROCK"
];

export function sanitizeCredentialValue(value: string): string {
  return value
    .trim()
    .replace(/^[\u2018\u2019\u201C\u201D'"]+/, "")
    .replace(/[\u2018\u2019\u201C\u201D'"]+$/, "");
}

export function sanitizedCredentialEnv(source: NodeJS.ProcessEnv = process.env): AdapterEnv {
  const result: AdapterEnv = {};

  for (const name of credentialEnvNames) {
    const value = source[name];
    if (value !== undefined) {
      result[name] = sanitizeCredentialValue(value);
    }
  }

  return result;
}
