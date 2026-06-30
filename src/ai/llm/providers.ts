import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createOllama } from "ollama-ai-provider";
import type { LanguageModel } from "ai";
import type { ProviderSpec } from "./types";

export function getModel(spec: ProviderSpec): LanguageModel {
  switch (spec.name) {
    case "anthropic": {
      const p = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      return p(spec.model) as LanguageModel;
    }
    case "openai": {
      const p = createOpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      return p(spec.model) as LanguageModel;
    }
    case "deepseek": {
      const p = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY! });
      return p(spec.model) as LanguageModel;
    }
    case "grok": {
      const p = createXai({ apiKey: process.env.XAI_API_KEY! });
      return p(spec.model) as LanguageModel;
    }
    case "ollama": {
      const p = createOllama({
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      });
      return p(spec.model) as unknown as LanguageModel;
    }
    case "gateway": {
      const p = createOpenAI({
        apiKey: process.env.AI_GATEWAY_API_KEY!,
        baseURL: process.env.AI_GATEWAY_BASE_URL!,
      });
      return p(spec.model) as LanguageModel;
    }
  }
}
