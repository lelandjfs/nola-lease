/**
 * Stage 3: Full Extraction
 *
 * Sends all page images to the model with structured extraction prompt.
 * Returns ExtractionMetric[] for all 27 fields.
 */

import { PageImage, DocumentType, ExtractionMetric } from "@/schema/types";
import { IModelProvider, Message, MessageContent } from "@/lib/models/types";
import { getModelProvider } from "@/lib/models";
import { getConfig } from "@/lib/config";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
} from "@/prompts/extraction_prompt";

/** Result of the extraction stage */
export interface ExtractionResult {
  /** All extracted metrics */
  metrics: ExtractionMetric[];
  /** Model used */
  model: string;
  /** Latency in ms */
  latencyMs: number;
  /** Any parsing errors */
  errors: string[];
}

/** Raw metric from model response (before adding source_document) */
interface RawMetric {
  metric: string;
  value: string | number | boolean | null;
  source_blurb: string;
  flags: string[];
}

/**
 * Extract all 27 fields from lease page images.
 *
 * @param pages - All page images from the PDF
 * @param documentType - Detected document type from Stage 2
 * @param sourceDocument - Original PDF filename
 * @param provider - Optional model provider (defaults to configured extraction provider)
 * @returns Extraction result with all metrics
 */
export async function extractLeaseData(
  pages: PageImage[],
  documentType: DocumentType,
  sourceDocument: string,
  provider?: IModelProvider
): Promise<ExtractionResult> {
  // Get provider (default to configured extraction provider)
  if (!provider) {
    const config = getConfig();
    provider = getModelProvider(
      config.models.extraction.provider,
      config.models.extraction.model
    );
  }

  // Build system prompt
  const systemPrompt = buildExtractionSystemPrompt(documentType);

  // Build user message with all page text (stage1 now extracts text, not images)
  // Decode all page text from base64 and combine
  const allPageText = pages
    .map((page, i) => {
      const text = Buffer.from(page.base64, "base64").toString("utf-8");
      return `--- PAGE ${i + 1} ---\n${text}`;
    })
    .join("\n\n");

  const userContent: MessageContent[] = [
    {
      type: "text",
      content: `${buildExtractionUserPrompt()}\n\n--- LEASE DOCUMENT TEXT ---\n${allPageText}`,
    },
  ];

  const messages: Message[] = [
    {
      role: "system",
      content: [{ type: "text", content: systemPrompt }],
    },
    {
      role: "user",
      content: userContent,
    },
  ];

  // Call the model
  const response = await provider.complete(messages, {
    maxTokens: 8192,
    temperature: 0,
  });

  // Parse JSON response
  const { metrics, errors } = parseExtractionResponse(
    response.content,
    sourceDocument
  );

  return {
    metrics,
    model: response.model,
    latencyMs: response.latencyMs,
    errors,
  };
}

/**
 * Parse the model's JSON response into ExtractionMetric objects.
 */
function parseExtractionResponse(
  responseText: string,
  sourceDocument: string
): { metrics: ExtractionMetric[]; errors: string[] } {
  const errors: string[] = [];
  let metrics: ExtractionMetric[] = [];

  try {
    // Try to extract JSON from response (handle markdown code blocks)
    let jsonStr = responseText;

    // Remove markdown code block if present
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Parse JSON
    const parsed = JSON.parse(jsonStr.trim());

    // Extract metrics array
    const rawMetrics: RawMetric[] = parsed.metrics || parsed;

    if (!Array.isArray(rawMetrics)) {
      throw new Error("Expected metrics array in response");
    }

    // Convert to ExtractionMetric with source_document
    metrics = rawMetrics.map((raw) => ({
      metric: raw.metric,
      value: raw.value,
      override: null,
      source_document: sourceDocument,
      source_blurb: raw.source_blurb || "",
      flags: raw.flags || [],
    }));
  } catch (e) {
    errors.push(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);

    // Try to salvage what we can with regex
    try {
      const metricMatches = responseText.matchAll(
        /"metric"\s*:\s*"([^"]+)"[\s\S]*?"value"\s*:\s*([^,}\]]+)/g
      );

      for (const match of metricMatches) {
        const metricName = match[1];
        let value: string | number | boolean | null = match[2].trim();

        // Parse value
        if (value === "null") {
          value = null;
        } else if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } else if (value.startsWith('"')) {
          value = value.slice(1, -1);
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        }

        metrics.push({
          metric: metricName,
          value,
          override: null,
          source_document: sourceDocument,
          source_blurb: "",
          flags: ["Extracted via fallback parser"],
        });
      }
    } catch {
      errors.push("Fallback parsing also failed");
    }
  }

  // Verify we have all expected fields
  const expectedFields = [
    "property",
    "tenant_name",
    "suite",
    "document_type",
    "suite_sf",
    "suite_pro_rata_share",
    "lease_start_date",
    "lease_term_months",
    "lease_expiration_date",
    "free_rent_months",
    "starting_rent_monthly",
    "rent_escalations",
    "escalation_type",
    "escalation_frequency",
    "lease_type",
    "security_deposit",
    "renewal_option",
    "renewal_option_term_months",
    "renewal_option_start_mos_prior",
    "renewal_option_exp_mos_prior",
    "termination_option",
    "termination_option_start",
    "termination_option_expiration",
    "rofo_option",
    "rofr_option",
    "purchase_option",
    "_flags",
  ];

  const extractedFields = new Set(metrics.map((m) => m.metric));
  const missingFields = expectedFields.filter((f) => !extractedFields.has(f));

  if (missingFields.length > 0) {
    errors.push(`Missing fields: ${missingFields.join(", ")}`);

    // Add placeholder metrics for missing fields
    for (const field of missingFields) {
      metrics.push({
        metric: field,
        value: null,
        override: null,
        source_document: sourceDocument,
        source_blurb: "",
        flags: ["Field not extracted - requires manual entry"],
      });
    }
  }

  return { metrics, errors };
}

/**
 * Get a specific metric by name from extraction results.
 */
export function getMetric(
  metrics: ExtractionMetric[],
  name: string
): ExtractionMetric | undefined {
  return metrics.find((m) => m.metric === name);
}

/**
 * Get the final value of a metric (override if set, else value).
 */
export function getFinalValue(
  metric: ExtractionMetric
): string | number | boolean | null {
  return metric.override ?? metric.value;
}
