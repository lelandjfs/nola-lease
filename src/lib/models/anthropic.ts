/**
 * Anthropic/Claude model provider implementation.
 * Best for structured extraction and reasoning tasks.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  IModelProvider,
  Message,
  InferenceOptions,
  ModelResponse,
  AnthropicModel,
} from "./types";

export class AnthropicProvider implements IModelProvider {
  readonly provider = "anthropic" as const;
  readonly model: AnthropicModel;
  private client: Anthropic;

  constructor(model: AnthropicModel = "claude-sonnet-4-5-20250929") {
    this.model = model;
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  supportsVision(): boolean {
    // All Claude 3+ models support vision
    return true;
  }

  async complete(
    messages: Message[],
    options: InferenceOptions = {}
  ): Promise<ModelResponse> {
    const startTime = Date.now();

    // Extract system message if present
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    // Convert our message format to Anthropic format
    const anthropicMessages = nonSystemMessages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content.map((c) => {
        if (c.type === "text") {
          return { type: "text" as const, text: c.content };
        } else {
          return {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: c.mediaType,
              data: c.base64,
            },
          };
        }
      }),
    }));

    // Build system prompt from system message content
    const systemPrompt = systemMessage
      ? systemMessage.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { type: "text"; content: string }).content)
          .join("\n")
      : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    const latencyMs = Date.now() - startTime;

    // Extract text content from response
    const textContent = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    return {
      content: textContent,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      latencyMs,
    };
  }
}
