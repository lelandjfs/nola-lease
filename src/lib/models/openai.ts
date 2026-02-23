/**
 * OpenAI model provider implementation.
 * Best for vision tasks (GPT-4o excels at document OCR).
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  IModelProvider,
  Message,
  InferenceOptions,
  ModelResponse,
  OpenAIModel,
} from "./types";

export class OpenAIProvider implements IModelProvider {
  readonly provider = "openai" as const;
  readonly model: OpenAIModel;
  private client: OpenAI;

  constructor(model: OpenAIModel = "gpt-4o") {
    this.model = model;
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  supportsVision(): boolean {
    // All GPT-4o variants support vision
    return this.model.startsWith("gpt-4o") || this.model === "gpt-4-turbo";
  }

  async complete(
    messages: Message[],
    options: InferenceOptions = {}
  ): Promise<ModelResponse> {
    const startTime = Date.now();

    // Convert our message format to OpenAI format
    const openaiMessages: ChatCompletionMessageParam[] = messages.map((msg) => {
      const content = msg.content.map((c) => {
        if (c.type === "text") {
          return { type: "text" as const, text: c.content };
        } else {
          return {
            type: "image_url" as const,
            image_url: {
              url: `data:${c.mediaType};base64,${c.base64}`,
              detail: "high" as const,
            },
          };
        }
      });

      // OpenAI requires different types for different roles
      if (msg.role === "system") {
        // System messages only support text
        const textContent = content.filter((c) => c.type === "text");
        return {
          role: "system" as const,
          content: textContent.map((c) => c.text).join("\n"),
        };
      } else if (msg.role === "assistant") {
        // Assistant messages only support text
        const textContent = content.filter((c) => c.type === "text");
        return {
          role: "assistant" as const,
          content: textContent.map((c) => c.text).join("\n"),
        };
      } else {
        // User messages support multimodal content
        return {
          role: "user" as const,
          content,
        };
      }
    });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
    });

    const latencyMs = Date.now() - startTime;

    return {
      content: response.choices[0]?.message?.content ?? "",
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  }
}
