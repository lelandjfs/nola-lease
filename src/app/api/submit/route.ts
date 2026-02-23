import { NextRequest, NextResponse } from "next/server";
import { getLeasesCollection, generateLeaseId } from "@/lib/mongodb";
import type {
  ExtractionMetric,
  PipelineOutput,
  LeaseDocument,
  LeaseData,
  ExtractionMeta,
  DocumentType,
  EscalationType,
  EscalationFrequency,
} from "@/schema/types";

interface SubmitPayload {
  pipeline_output: PipelineOutput;
  reviewed_metrics: ExtractionMetric[];
  reviewer: string;
  reviewer_notes: string | null;
  /** OAuth user identity - will be auto-filled from session when OAuth is enabled */
  approved_by?: string | null;
}

/**
 * Convert reviewed metrics array to flat LeaseData object.
 */
function metricsToLeaseData(metrics: ExtractionMetric[]): LeaseData {
  const getValue = (name: string): string | number | boolean | null => {
    const metric = metrics.find((m) => m.metric === name);
    if (!metric) return null;
    return metric.override ?? metric.value;
  };

  return {
    property: String(getValue("property") ?? ""),
    tenant_name: String(getValue("tenant_name") ?? ""),
    suite: String(getValue("suite") ?? ""),
    document_type: (getValue("document_type") as DocumentType) ?? "NNN",
    suite_sf: Number(getValue("suite_sf") ?? 0),
    suite_pro_rata_share: Number(getValue("suite_pro_rata_share") ?? 0),
    lease_start_date: getValue("lease_start_date") as string | null,
    lease_term_months: Number(getValue("lease_term_months") ?? 0),
    lease_expiration_date: getValue("lease_expiration_date") as string | null,
    free_rent_months: Number(getValue("free_rent_months") ?? 0),
    starting_rent_monthly: Number(getValue("starting_rent_monthly") ?? 0),
    rent_escalations: Number(getValue("rent_escalations") ?? 0),
    escalation_type: (getValue("escalation_type") as EscalationType) ?? "percentage",
    escalation_frequency: (getValue("escalation_frequency") as EscalationFrequency) ?? "annual",
    security_deposit: Number(getValue("security_deposit") ?? 0),
    lease_type: (getValue("lease_type") as DocumentType) ?? "NNN",
    renewal_option: Boolean(getValue("renewal_option")),
    renewal_option_term_months: getValue("renewal_option_term_months") as number | null,
    renewal_option_start_mos_prior: getValue("renewal_option_start_mos_prior") as number | null,
    renewal_option_exp_mos_prior: getValue("renewal_option_exp_mos_prior") as number | null,
    termination_option: Boolean(getValue("termination_option")),
    termination_option_start: getValue("termination_option_start") as string | null,
    termination_option_expiration: getValue("termination_option_expiration") as string | null,
    rofo_option: Boolean(getValue("rofo_option")),
    rofr_option: Boolean(getValue("rofr_option")),
    purchase_option: Boolean(getValue("purchase_option")),
    _flags: [],
  };
}

/**
 * Count how many metrics were overridden by the reviewer.
 */
function countOverrides(metrics: ExtractionMetric[]): number {
  return metrics.filter((m) => m.override !== null).length;
}

export async function POST(request: NextRequest) {
  try {
    const payload: SubmitPayload = await request.json();

    const { pipeline_output, reviewed_metrics, reviewer, reviewer_notes, approved_by } = payload;

    // Convert metrics to flat lease data
    const leaseData = metricsToLeaseData(reviewed_metrics);

    // Generate document ID
    const docId = generateLeaseId(leaseData.property, leaseData.tenant_name);

    const now = new Date().toISOString();

    // Build extraction metadata for audit trail
    const extractionMeta: ExtractionMeta = {
      extracted_at: pipeline_output.extracted_at,
      source_document: pipeline_output.filename,
      model: pipeline_output.model,
      pipeline_version: "1.0.0",
      metrics: reviewed_metrics,
      validation_results: pipeline_output.validation_results,
      human_reviewed: true,
      reviewed_by: reviewer,
      reviewed_at: now,
      // OAuth fields - null until OAuth is enabled, then auto-filled from session
      approved_by: approved_by ?? null,
      approved_at: approved_by ? now : null,
      overrides_applied: countOverrides(reviewed_metrics),
    };

    // Build full document
    const leaseDocument: LeaseDocument = {
      _id: docId,
      ...leaseData,
      _extraction: extractionMeta,
    };

    // Get collection and upsert document
    const collection = await getLeasesCollection();

    // Use upsert to allow re-processing of same lease
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await collection.updateOne(
      { _id: docId } as any,
      { $set: leaseDocument },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      document_id: docId,
      overrides_applied: extractionMeta.overrides_applied,
    });
  } catch (error) {
    console.error("Submit error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Submit failed" },
      { status: 500 }
    );
  }
}
