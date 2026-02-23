/**
 * Core type definitions for the lease extraction pipeline.
 * Based on the implementation spec derived from 3 commercial leases.
 */

// =============================================================================
// EXTRACTION OUTPUT SCHEMA
// =============================================================================

/**
 * A single extracted field from a lease.
 * Every extracted value flows through the review interface before persisting.
 */
export interface ExtractionMetric {
  /** snake_case field name (e.g., "tenant_name") */
  metric: string;
  /** Extracted value (string | number | boolean | null) */
  value: string | number | boolean | null;
  /** null until human changes it in review UI */
  override: string | number | boolean | null;
  /** Filename of the PDF (e.g., "Armanino_Lease-03162020.pdf") */
  source_document: string;
  /** Paragraph or sentence where the value was found */
  source_blurb: string;
  /** Human-readable notes (e.g., ["Anticipated date — confirm with Commencement Date Agreement"]) */
  flags: string[];
}

/**
 * Get the final value for a metric (override if set, otherwise original value)
 */
export function getFinalValue(metric: ExtractionMetric): string | number | boolean | null {
  return metric.override ?? metric.value;
}

// =============================================================================
// LEASE DATA FIELDS (27 Fields)
// =============================================================================

/** Document/lease type classification */
export type DocumentType = "NNN" | "FSG" | "MG" | "IG" | "ANN";

/** How to interpret rent_escalations value */
export type EscalationType =
  | "percentage"
  | "fixed_dollar_per_rsf"
  | "fixed_dollar_per_month"
  | "cpi"
  | "fmv"
  | "step_schedule";

/** Escalation frequency */
export type EscalationFrequency = "annual" | "semi_annual" | "monthly";

/**
 * The 27 fields extracted from every lease.
 * First 24 match existing CSV schema (snake_cased), plus document_type, escalation_type, and _flags.
 */
export interface LeaseData {
  // --- identifiers ---
  /** Normalized building name (e.g., "155 Bellevue") */
  property: string;
  /** DBA preferred; legal suffix stripped */
  tenant_name: string;
  /** Suite number */
  suite: string;
  /** "NNN" | "FSG" | "MG" | "IG" | "ANN" */
  document_type: DocumentType;

  // --- space ---
  /** Rentable square feet */
  suite_sf: number;
  /** Decimal (e.g., 0.0481 for 4.81%) */
  suite_pro_rata_share: number;

  // --- dates ---
  /** ISO date string or null if not determinable */
  lease_start_date: string | null;
  /** Integer months */
  lease_term_months: number;
  /** ISO date string or null (calculated from start + term) */
  lease_expiration_date: string | null;

  // --- rent ---
  /** 0 if none */
  free_rent_months: number;
  /** Monthly dollar amount */
  starting_rent_monthly: number;
  /** Rate VALUE (e.g., 0.03 for 3%, or 1.00 for $1/RSF) */
  rent_escalations: number;
  /** How to interpret rent_escalations */
  escalation_type: EscalationType;
  /** "annual" | "semi_annual" | "monthly" */
  escalation_frequency: EscalationFrequency;

  // --- financial ---
  /** Dollar amount */
  security_deposit: number;

  // --- lease type ---
  /** Same as document_type (kept for CSV backwards compatibility) */
  lease_type: DocumentType;

  // --- options ---
  renewal_option: boolean;
  /** null if no renewal */
  renewal_option_term_months: number | null;
  /** null if no upper bound or no renewal */
  renewal_option_start_mos_prior: number | null;
  /** null if no renewal */
  renewal_option_exp_mos_prior: number | null;

  /** Voluntary only — NOT casualty/default/condemnation */
  termination_option: boolean;
  /** Date or description, null if no termination option */
  termination_option_start: string | null;
  termination_option_expiration: string | null;

  /** Right of First Offer */
  rofo_option: boolean;
  /** Right of First Refusal */
  rofr_option: boolean;
  purchase_option: boolean;

  // --- pipeline metadata ---
  /** Top-level flags for the entire lease extraction */
  _flags: string[];
}

// =============================================================================
// VALIDATION
// =============================================================================

/** Validation check status */
export type ValidationStatus = "PASS" | "FAIL" | "FLAG" | "SKIP";

/** Result of a single validation check */
export interface ValidationResult {
  /** Check identifier */
  check:
    | "rent_math"
    | "pro_rata"
    | "date_arithmetic"
    | "escalation_consistency"
    | "deposit_sanity";
  /** PASS, FAIL, FLAG, or SKIP */
  status: ValidationStatus;
  /** Human-readable explanation */
  detail: string;
}

// =============================================================================
// MONGODB DOCUMENT
// =============================================================================

/**
 * Extraction metadata stored with each lease document.
 * Provides full audit trail.
 */
export interface ExtractionMeta {
  /** ISO timestamp */
  extracted_at: string;
  /** PDF filename */
  source_document: string;
  /** e.g., "claude-sonnet-4-5-20250929" or "gpt-4o-2024-08-06" */
  model: string;
  /** Pipeline version identifier */
  pipeline_version: string;
  /** Full extraction output with source_blurbs (for audit trail) */
  metrics: ExtractionMetric[];
  /** Cross-check results */
  validation_results: ValidationResult[];
  /** Whether a human has reviewed */
  human_reviewed: boolean;
  /** Reviewer identifier (temporary, pre-OAuth) */
  reviewed_by: string | null;
  /** ISO timestamp of review */
  reviewed_at: string | null;
  /** OAuth user who approved (email or user ID) - auto-filled from session */
  approved_by: string | null;
  /** ISO timestamp of approval */
  approved_at: string | null;
  /** Count of fields the human changed */
  overrides_applied: number;
}

/**
 * Full MongoDB document for a lease.
 * Top-level is flat (all 27 fields at root) for easy querying.
 * _extraction subdocument holds the audit trail.
 */
export interface LeaseDocument extends LeaseData {
  /** Generated ID (e.g., "lease_armanino_columbia_west") */
  _id: string;
  /** Full extraction audit trail */
  _extraction: ExtractionMeta;
}

// =============================================================================
// PIPELINE TYPES
// =============================================================================

/** Stage of the extraction pipeline */
export type PipelineStage =
  | "pdf_to_images"
  | "lease_type_detection"
  | "extraction"
  | "validation"
  | "retry"
  | "package";

/** Result from PDF to images conversion */
export interface PageImage {
  /** 1-indexed page number */
  pageNumber: number;
  /** Base64 encoded image data */
  base64: string;
  /** Image format */
  format: "png" | "jpeg";
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

/** Full pipeline output ready for review interface */
export interface PipelineOutput {
  /** Original PDF filename */
  filename: string;
  /** Detected document type */
  document_type: DocumentType;
  /** All extracted metrics */
  metrics: ExtractionMetric[];
  /** Validation check results */
  validation_results: ValidationResult[];
  /** Number of pages in the PDF */
  page_count: number;
  /** Model used for extraction */
  model: string;
  /** ISO timestamp */
  extracted_at: string;
  /** Any pipeline-level errors */
  errors: string[];
}

// =============================================================================
// REVIEW INTERFACE TYPES
// =============================================================================

/** Payload submitted after human review */
export interface ReviewSubmission {
  /** Original pipeline output */
  pipeline_output: PipelineOutput;
  /** Metrics with any overrides applied */
  reviewed_metrics: ExtractionMetric[];
  /** Reviewer identifier */
  reviewer: string;
  /** Any notes from the reviewer */
  reviewer_notes: string | null;
  /** ISO timestamp of submission */
  submitted_at: string;
}
