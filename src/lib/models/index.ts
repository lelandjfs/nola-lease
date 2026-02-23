/**
 * Model provider factory and exports.
 * Use getModelProvider() to get a configured provider instance.
 */

import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import {
  IModelProvider,
  ModelProvider,
  ModelId,
  PipelineModelConfig,
  DEFAULT_MODEL_CONFIG,
} from "./types";

// Re-export types
export * from "./types";
export { OpenAIProvider } from "./openai";
export { AnthropicProvider } from "./anthropic";

/**
 * Get a model provider instance for the given provider and model.
 */
export function getModelProvider(
  provider: ModelProvider,
  model: ModelId
): IModelProvider {
  switch (provider) {
    case "openai":
      return new OpenAIProvider(model as any);
    case "anthropic":
      return new AnthropicProvider(model as any);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Get model providers for each pipeline stage based on config.
 */
export function getPipelineProviders(
  config: PipelineModelConfig = DEFAULT_MODEL_CONFIG
) {
  return {
    vision: getModelProvider(config.vision.provider, config.vision.model),
    classification: getModelProvider(
      config.classification.provider,
      config.classification.model
    ),
    extraction: getModelProvider(
      config.extraction.provider,
      config.extraction.model
    ),
    reasoning: getModelProvider(
      config.reasoning.provider,
      config.reasoning.model
    ),
  };
}

/**
 * Quick helper to get the default vision provider (OpenAI GPT-4o).
 */
export function getVisionProvider(): IModelProvider {
  return new OpenAIProvider("gpt-4o");
}

/**
 * Quick helper to get the default extraction provider (Claude).
 */
export function getExtractionProvider(): IModelProvider {
  return new AnthropicProvider("claude-sonnet-4-5-20250929");
}
