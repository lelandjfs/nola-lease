/**
 * Model provider abstraction types.
 * Allows toggling between OpenAI and Claude for different pipeline stages.
 */

/** Supported model providers */
export type ModelProvider = "openai" | "anthropic";

/** Specific model identifiers */
export type OpenAIModel = "gpt-4o" | "gpt-4o-mini" | "gpt-4-turbo";
export type AnthropicModel = "claude-sonnet-4-5-20250929" | "claude-3-5-sonnet-20241022" | "claude-3-haiku-20240307";
export type ModelId = OpenAIModel | AnthropicModel;

/** Input types for model calls */
export interface TextInput {
  type: "text";
  content: string;
}

export interface ImageInput {
  type: "image";
  /** Base64 encoded image */
  base64: string;
  /** MIME type */
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}

export type MessageContent = TextInput | ImageInput;

/** A single message in a conversation */
export interface Message {
  role: "user" | "assistant" | "system";
  content: MessageContent[];
}

/** Options for model inference */
export interface InferenceOptions {
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** Whether to request JSON output */
  jsonMode?: boolean;
}

/** Response from a model call */
export interface ModelResponse {
  /** The generated text content */
  content: string;
  /** Model identifier used */
  model: string;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Time taken in ms */
  latencyMs: number;
}

/** Base interface for model providers */
export interface IModelProvider {
  /** Provider identifier */
  readonly provider: ModelProvider;
  /** Model being used */
  readonly model: ModelId;

  /**
   * Send a message and get a response.
   * Supports both text and vision inputs.
   */
  complete(
    messages: Message[],
    options?: InferenceOptions
  ): Promise<ModelResponse>;

  /**
   * Check if this provider supports vision/image inputs.
   */
  supportsVision(): boolean;
}

/** Configuration for which models to use at each pipeline stage */
export interface PipelineModelConfig {
  /** Model for page image → text extraction (needs vision) */
  vision: {
    provider: ModelProvider;
    model: ModelId;
  };
  /** Model for lease type classification */
  classification: {
    provider: ModelProvider;
    model: ModelId;
  };
  /** Model for structured field extraction */
  extraction: {
    provider: ModelProvider;
    model: ModelId;
  };
  /** Model for retry/validation reasoning */
  reasoning: {
    provider: ModelProvider;
    model: ModelId;
  };
}

/** Default configuration - can be overridden */
export const DEFAULT_MODEL_CONFIG: PipelineModelConfig = {
  vision: {
    provider: "openai",
    model: "gpt-4o",
  },
  classification: {
    provider: "openai",
    model: "gpt-4o-mini",
  },
  extraction: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
  },
  reasoning: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
  },
};
