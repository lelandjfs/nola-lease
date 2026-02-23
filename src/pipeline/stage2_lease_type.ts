/**
 * Stage 2: Lease Type Detection
 *
 * Analyzes page 1 of the lease to classify the document type.
 * Uses vision model to read headers and first paragraphs.
 */

import { PageImage, DocumentType } from "@/schema/types";
import { IModelProvider, Message } from "@/lib/models/types";
import { getModelProvider } from "@/lib/models";
import { getConfig } from "@/lib/config";

/** Result of lease type detection */
export interface LeaseTypeResult {
  /** Detected document type */
  documentType: DocumentType;
  /** Raw response from model */
  rawResponse: string;
  /** Model used */
  model: string;
  /** Latency in ms */
  latencyMs: number;
}

/** The prompt for lease type classification */
const LEASE_TYPE_PROMPT = `You are analyzing the first page of a commercial lease document.

Look at the document header, title, and first paragraph to determine what type of commercial lease this is.

Classify as ONE of these types:
- NNN: Triple-net lease. Tenant pays base rent plus all operating expenses (property taxes, insurance, CAM/maintenance). Look for: "triple-net", "NNN", "net net net"
- FSG: Full Service Gross / Base Year Gross. Landlord includes base operating costs in rent, tenant pays increases over base year. Look for: "full service", "gross lease", "base year"
- MG: Modified Gross. Hybrid where some expenses are included, others passed through. Look for: "modified gross"
- IG: Industrial Gross. Common for warehouse/industrial, typically includes some but not all expenses. Look for: "industrial", warehouse context with gross structure
- ANN: Absolute Net / Bondable Net. Tenant responsible for absolutely everything including structural repairs. Rare. Look for: "absolute net", "bondable"

CRITICAL - EXPLICIT LANGUAGE TAKES PRIORITY:
- If the document EXPLICITLY states "triple-net", "NNN", or "net net net" anywhere, classify as NNN
- If the document EXPLICITLY states "gross lease" or "full service", classify as FSG
- Do NOT override explicit lease type language based on perceived structure
- Many NNN leases have base year expense structures but are still NNN leases
- Trust what the lease SAYS it is, not what you infer from structure

Only if NO explicit type language exists, then infer from structure.

Respond with ONLY the type code (NNN, FSG, MG, IG, or ANN) and nothing else.`;

/**
 * Detect the lease type from the first page of a document.
 *
 * @param firstPage - The first page image
 * @param provider - Optional model provider (defaults to configured vision provider)
 * @returns Lease type detection result
 */
export async function detectLeaseType(
  firstPage: PageImage,
  provider?: IModelProvider
): Promise<LeaseTypeResult> {
  // Get provider (default to configured vision provider)
  if (!provider) {
    const config = getConfig();
    provider = getModelProvider(
      config.models.vision.provider,
      config.models.vision.model
    );
  }

  // Decode text from base64 (stage1 now extracts text, not images)
  const pageText = Buffer.from(firstPage.base64, "base64").toString("utf-8");

  // Build message with text content
  const messages: Message[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          content: `${LEASE_TYPE_PROMPT}\n\n--- FIRST PAGE TEXT ---\n${pageText}`,
        },
      ],
    },
  ];

  // Call the model
  const response = await provider.complete(messages, {
    maxTokens: 10,
    temperature: 0,
  });

  // Parse response
  const rawResponse = response.content.trim().toUpperCase();
  let documentType: DocumentType;

  // Extract the type code from response
  if (rawResponse.includes("NNN")) {
    documentType = "NNN";
  } else if (rawResponse.includes("FSG")) {
    documentType = "FSG";
  } else if (rawResponse.includes("MG")) {
    documentType = "MG";
  } else if (rawResponse.includes("IG")) {
    documentType = "IG";
  } else if (rawResponse.includes("ANN")) {
    documentType = "ANN";
  } else {
    // Default to FSG if unclear (most common for office)
    documentType = "FSG";
  }

  return {
    documentType,
    rawResponse: response.content,
    model: response.model,
    latencyMs: response.latencyMs,
  };
}

/**
 * Check if filename indicates this is an amendment (not a base lease).
 */
export function isAmendment(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes("amendment") ||
    lower.includes("amend") ||
    lower.includes("addendum") ||
    lower.includes("modification")
  );
}
