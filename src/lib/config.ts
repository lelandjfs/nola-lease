/**
 * Application configuration.
 * Loads from environment variables with sensible defaults.
 */

import { PipelineModelConfig, ModelProvider, ModelId } from "./models/types";

export interface AppConfig {
  /** OpenAI API key */
  openaiApiKey: string | undefined;
  /** Anthropic API key */
  anthropicApiKey: string | undefined;
  /** MongoDB connection URI */
  mongodbUri: string;
  /** MongoDB database name */
  mongodbDb: string;
  /** Directory for input lease PDFs */
  leaseInputDir: string;
  /** Pipeline model configuration */
  models: PipelineModelConfig;
}

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): AppConfig {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017",
    mongodbDb: process.env.MONGODB_DB ?? "lease_extraction",
    leaseInputDir: process.env.LEASE_INPUT_DIR ?? "./leases",
    models: loadModelConfig(),
  };
}

/**
 * Load model configuration from environment variables.
 * Falls back to sensible defaults if not specified.
 */
function loadModelConfig(): PipelineModelConfig {
  return {
    vision: {
      provider: (process.env.VISION_PROVIDER as ModelProvider) ?? "openai",
      model: (process.env.VISION_MODEL as ModelId) ?? "gpt-4o",
    },
    classification: {
      provider:
        (process.env.CLASSIFICATION_PROVIDER as ModelProvider) ?? "openai",
      model: (process.env.CLASSIFICATION_MODEL as ModelId) ?? "gpt-4o-mini",
    },
    extraction: {
      provider:
        (process.env.EXTRACTION_PROVIDER as ModelProvider) ?? "anthropic",
      model:
        (process.env.EXTRACTION_MODEL as ModelId) ?? "claude-sonnet-4-5-20250929",
    },
    reasoning: {
      provider:
        (process.env.REASONING_PROVIDER as ModelProvider) ?? "anthropic",
      model:
        (process.env.REASONING_MODEL as ModelId) ?? "claude-sonnet-4-5-20250929",
    },
  };
}

/**
 * Validate that required configuration is present.
 * Returns array of missing config keys.
 */
export function validateConfig(config: AppConfig): string[] {
  const missing: string[] = [];

  // Check for at least one API key
  if (!config.openaiApiKey && !config.anthropicApiKey) {
    missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }

  // Check if selected providers have their API keys
  const providersNeeded = new Set<ModelProvider>();
  providersNeeded.add(config.models.vision.provider);
  providersNeeded.add(config.models.classification.provider);
  providersNeeded.add(config.models.extraction.provider);
  providersNeeded.add(config.models.reasoning.provider);

  if (providersNeeded.has("openai") && !config.openaiApiKey) {
    missing.push("OPENAI_API_KEY (required for selected models)");
  }
  if (providersNeeded.has("anthropic") && !config.anthropicApiKey) {
    missing.push("ANTHROPIC_API_KEY (required for selected models)");
  }

  return missing;
}

// Singleton config instance
let _config: AppConfig | null = null;

/**
 * Get the application config (cached after first load).
 */
export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
