/**
 * Pipeline Orchestrator
 *
 * Ties together all pipeline stages:
 * Stage 1: PDF → Page Images
 * Stage 2: Lease Type Detection
 * Stage 3: Full Extraction
 *
 * Future stages (Session 3):
 * Stage 4: Validation
 * Stage 5: Retry
 * Stage 6: Package for Review
 */

import * as path from "path";
import { PipelineOutput, ExtractionMetric, DocumentType } from "@/schema/types";
import { pdfToImages, RenderOptions } from "./stage1_pdf_to_images";
import { detectLeaseType, isAmendment } from "./stage2_lease_type";
import { extractLeaseData } from "./stage3_extraction";
import {
  runValidation,
  applyEscalationCorrection,
  applyLeaseTypeCorrection,
  analyzeEscalation,
} from "./stage4_validation";

// Re-export stage functions
export { pdfToImages, pdfBytesToImages, getPdfPageCount } from "./stage1_pdf_to_images";
export { detectLeaseType, isAmendment } from "./stage2_lease_type";
export { extractLeaseData, getMetric, getFinalValue } from "./stage3_extraction";
export {
  runValidation,
  applyEscalationCorrection,
  applyLeaseTypeCorrection,
  analyzeEscalation,
  validateRentMath,
  validateProRata,
  validateDateArithmetic,
  validateEscalationConsistency,
  validateDepositSanity,
} from "./stage4_validation";

/** Options for running the pipeline */
export interface PipelineOptions {
  /** PDF rendering options */
  renderOptions?: RenderOptions;
  /** Skip lease type detection and use this type */
  forceDocumentType?: DocumentType;
  /** Skip extraction (useful for testing stages 1-2) */
  skipExtraction?: boolean;
  /** Maximum pages to process (default: 25, covers most lease content) */
  maxPages?: number;
}

/** Result when pipeline is skipped (e.g., for amendments) */
export interface PipelineSkipped {
  status: "skipped";
  reason: string;
  filename: string;
}

/** Full pipeline result */
export type PipelineResult = PipelineOutput | PipelineSkipped;

/**
 * Run the full extraction pipeline on a PDF file.
 *
 * @param pdfPath - Path to the PDF file
 * @param options - Pipeline options
 * @returns Pipeline output or skipped result
 */
export async function runPipeline(
  pdfPath: string,
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const filename = path.basename(pdfPath);
  const startTime = Date.now();
  const errors: string[] = [];

  console.log(`\n📄 Processing: ${filename}`);

  // Check if this is an amendment
  if (isAmendment(filename)) {
    console.log("⏭️  Skipping: Amendment detected");
    return {
      status: "skipped",
      reason: "Amendment detected - amendment processing not yet implemented",
      filename,
    };
  }

  // Stage 1: PDF to Images
  console.log("🖼️  Stage 1: Converting PDF to images...");
  let pages = await pdfToImages(pdfPath, options.renderOptions);
  console.log(`   ✓ Converted ${pages.length} pages`);

  if (pages.length === 0) {
    throw new Error("No pages extracted from PDF");
  }

  // Limit pages to avoid API payload limits
  const maxPages = options.maxPages ?? 25;
  if (pages.length > maxPages) {
    console.log(`   ⚠️  Limiting to first ${maxPages} pages (was ${pages.length})`);
    pages = pages.slice(0, maxPages);
  }

  // Stage 2: Lease Type Detection
  let documentType: DocumentType;

  if (options.forceDocumentType) {
    documentType = options.forceDocumentType;
    console.log(`📋 Stage 2: Using forced document type: ${documentType}`);
  } else {
    console.log("📋 Stage 2: Detecting lease type...");
    const typeResult = await detectLeaseType(pages[0]);
    documentType = typeResult.documentType;
    console.log(
      `   ✓ Detected: ${documentType} (${typeResult.latencyMs}ms, ${typeResult.model})`
    );
  }

  // Stage 3: Full Extraction
  let metrics: ExtractionMetric[] = [];
  let model = "";

  if (options.skipExtraction) {
    console.log("⏭️  Stage 3: Skipping extraction (skipExtraction=true)");
  } else {
    console.log("🔍 Stage 3: Extracting lease data...");
    const extractionResult = await extractLeaseData(
      pages,
      documentType,
      filename
    );
    metrics = extractionResult.metrics;
    model = extractionResult.model;
    errors.push(...extractionResult.errors);

    console.log(
      `   ✓ Extracted ${metrics.length} fields (${extractionResult.latencyMs}ms, ${model})`
    );

    if (extractionResult.errors.length > 0) {
      console.log(`   ⚠️  ${extractionResult.errors.length} extraction errors`);
    }
  }

  // Stage 4: Validation & Correction
  let validationResults: import("@/schema/types").ValidationResult[] = [];

  if (metrics.length > 0) {
    console.log("✔️  Stage 4: Running validation checks...");

    // Apply corrections
    metrics = applyLeaseTypeCorrection(metrics);
    metrics = applyEscalationCorrection(metrics);

    // Run all validation checks
    validationResults = runValidation(metrics);

    const passed = validationResults.filter((r) => r.status === "PASS").length;
    const failed = validationResults.filter((r) => r.status === "FAIL").length;
    const flagged = validationResults.filter((r) => r.status === "FLAG").length;

    console.log(
      `   ✓ ${passed} passed, ${failed} failed, ${flagged} flagged`
    );

    // Count flagged metrics (after correction)
    const flaggedMetrics = metrics.filter((m) => m.flags.length > 0).length;
    if (flaggedMetrics > 0) {
      console.log(`   ⚠️  ${flaggedMetrics} fields have flags for review`);
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`✅ Pipeline complete (${totalTime}ms total)\n`);

  return {
    filename,
    document_type: documentType,
    metrics,
    validation_results: validationResults,
    page_count: pages.length,
    model,
    extracted_at: new Date().toISOString(),
    errors,
  };
}

/**
 * Check if a pipeline result was skipped.
 */
export function wasSkipped(result: PipelineResult): result is PipelineSkipped {
  return "status" in result && result.status === "skipped";
}

/**
 * Pretty print pipeline output for debugging.
 */
export function printPipelineOutput(output: PipelineOutput): void {
  console.log("\n" + "=".repeat(60));
  console.log(`📄 ${output.filename}`);
  console.log(`📋 Type: ${output.document_type}`);
  console.log(`📑 Pages: ${output.page_count}`);
  console.log(`🤖 Model: ${output.model}`);
  console.log("=".repeat(60));

  console.log("\n📊 Extracted Fields:\n");

  for (const metric of output.metrics) {
    const flagIndicator = metric.flags.length > 0 ? "⚠️ " : "✓ ";
    const value =
      metric.value === null
        ? "(null)"
        : typeof metric.value === "boolean"
        ? metric.value
          ? "Yes"
          : "No"
        : String(metric.value);

    console.log(`${flagIndicator}${metric.metric}: ${value}`);

    if (metric.source_blurb) {
      const truncated =
        metric.source_blurb.length > 80
          ? metric.source_blurb.substring(0, 80) + "..."
          : metric.source_blurb;
      console.log(`   └─ "${truncated}"`);
    }

    for (const flag of metric.flags) {
      console.log(`   ⚠️  ${flag}`);
    }
  }

  // Show validation results
  if (output.validation_results.length > 0) {
    console.log("\n📋 Validation Checks:");
    for (const result of output.validation_results) {
      const icon =
        result.status === "PASS"
          ? "✅"
          : result.status === "FAIL"
          ? "❌"
          : result.status === "FLAG"
          ? "⚠️"
          : "⏭️";
      console.log(`   ${icon} ${result.check}: ${result.detail}`);
    }
  }

  if (output.errors.length > 0) {
    console.log("\n❌ Errors:");
    for (const error of output.errors) {
      console.log(`   - ${error}`);
    }
  }

  console.log("\n" + "=".repeat(60) + "\n");
}
