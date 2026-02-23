"use client";

import { useState, useCallback, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { ValidationPanel } from "@/components/ValidationPanel";
import { FileUpload } from "@/components/FileUpload";
import { runValidation } from "@/pipeline/stage4_validation";
import type { PipelineOutput, ExtractionMetric } from "@/schema/types";

type ReviewState = "idle" | "uploading" | "processing" | "reviewing" | "submitting" | "submitted";

// Field categories for organized display
const FIELD_CATEGORIES: Record<string, string[]> = {
  "Property & Tenant": ["property", "tenant_name", "suite", "document_type", "lease_type"],
  "Space": ["suite_sf", "suite_pro_rata_share"],
  "Dates & Term": ["lease_start_date", "lease_term_months", "lease_expiration_date"],
  "Rent": ["starting_rent_monthly", "free_rent_months", "rent_escalations", "escalation_type", "escalation_frequency"],
  "Financial": ["security_deposit"],
  "Options": ["renewal_option", "renewal_option_term_months", "renewal_option_start_mos_prior", "renewal_option_exp_mos_prior", "termination_option", "termination_option_start", "termination_option_expiration", "rofo_option", "rofr_option", "purchase_option"],
};

// Metadata fields that should not appear in review UI
const HIDDEN_FIELDS = ["_flags"];

/**
 * FORMULA FIELDS - These are auto-calculated when their source fields change:
 *
 * 1. lease_expiration_date = lease_start_date + lease_term_months
 *    - Source: lease_start_date, lease_term_months
 *    - Formula: Add term months to start date, then subtract 1 day
 *
 * Future formula fields to add:
 * 2. suite_pro_rata_share = suite_sf / building_total_sf (if building SF available)
 * 3. annual_rent = starting_rent_monthly * 12
 * 4. rent_per_sf = starting_rent_monthly * 12 / suite_sf
 */
const FORMULA_FIELDS: Record<string, string[]> = {
  lease_expiration_date: ["lease_start_date", "lease_term_months"],
};

/**
 * Check if a field is a formula field (auto-calculated)
 */
function isFormulaField(fieldName: string): boolean {
  return fieldName in FORMULA_FIELDS;
}

/**
 * Get the source fields that a formula field depends on
 */
function getSourceFields(fieldName: string): string[] {
  return FORMULA_FIELDS[fieldName] || [];
}

/**
 * Recalculate all dependent formula fields when a source field changes.
 */
function recalculateDependentFields(
  metrics: ExtractionMetric[],
  changedMetric: string,
  newValue: string | number | boolean | null
): ExtractionMetric[] {
  const getValue = (name: string): string | number | boolean | null => {
    const m = metrics.find((m) => m.metric === name);
    if (!m) return null;
    return m.override ?? m.value;
  };

  let updatedMetrics = [...metrics];

  // Check each formula field to see if it depends on the changed metric
  for (const [formulaField, sourceFields] of Object.entries(FORMULA_FIELDS)) {
    if (!sourceFields.includes(changedMetric)) continue;

    // Recalculate based on formula field type
    if (formulaField === "lease_expiration_date") {
      const startDate = changedMetric === "lease_start_date" ? newValue : getValue("lease_start_date");
      const termMonths = changedMetric === "lease_term_months" ? newValue : getValue("lease_term_months");

      if (startDate && typeof startDate === "string" && typeof termMonths === "number") {
        try {
          const start = new Date(startDate);
          start.setMonth(start.getMonth() + termMonths);
          start.setDate(start.getDate() - 1); // Last day of term
          const newExpiration = start.toISOString().split("T")[0];

          updatedMetrics = updatedMetrics.map((m) => {
            if (m.metric === "lease_expiration_date") {
              return {
                ...m,
                override: newExpiration,
                flags: [
                  ...m.flags.filter((f) => !f.includes("Auto-calculated")),
                  `Auto-calculated: ${startDate} + ${termMonths} months`,
                ],
              };
            }
            return m;
          });
        } catch {
          // Invalid date, skip recalculation
        }
      }
    }
  }

  return updatedMetrics;
}

export default function Home() {
  const [state, setState] = useState<ReviewState>("idle");
  const [pipelineOutput, setPipelineOutput] = useState<PipelineOutput | null>(null);
  const [metrics, setMetrics] = useState<ExtractionMetric[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Track which flagged metrics have been actioned (approved or overridden)
  const [actionedMetrics, setActionedMetrics] = useState<Set<string>>(new Set());

  // Handle file upload - clears all previous state first
  const handleFileUpload = useCallback(async (file: File) => {
    // Clear all previous state before starting new upload
    setPipelineOutput(null);
    setMetrics([]);
    setActionedMetrics(new Set());
    setError(null);
    setState("uploading");

    try {
      const formData = new FormData();
      formData.append("file", file);

      setState("processing");
      const response = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Extraction failed");
      }

      const result: PipelineOutput = await response.json();
      setPipelineOutput(result);
      setMetrics(result.metrics);
      setState("reviewing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("idle");
    }
  }, []);

  // Handle metric override with automatic recalculation of dependent fields
  const handleOverride = useCallback((metricName: string, newValue: string | number | boolean | null) => {
    setMetrics((prev) => {
      // First, apply the override
      let updated = prev.map((m) =>
        m.metric === metricName ? { ...m, override: newValue } : m
      );
      // Then recalculate any dependent fields
      updated = recalculateDependentFields(updated, metricName, newValue);
      return updated;
    });
    // Mark as actioned (moves from "Needs Attention" to category section)
    setActionedMetrics((prev) => new Set(prev).add(metricName));
  }, []);

  // Handle approve (mark as actioned, keep original value)
  const handleApprove = useCallback((metricName: string) => {
    // Mark as actioned (moves from "Needs Attention" to category section)
    setActionedMetrics((prev) => new Set(prev).add(metricName));
  }, []);

  // Handle revert (clear override and remove from actioned - goes back to Needs Attention if flagged)
  const handleRevert = useCallback((metricName: string) => {
    // Clear the override
    setMetrics((prev) =>
      prev.map((m) =>
        m.metric === metricName ? { ...m, override: null } : m
      )
    );
    // Remove from actioned set (will go back to Needs Attention if originally flagged)
    setActionedMetrics((prev) => {
      const next = new Set(prev);
      next.delete(metricName);
      return next;
    });
  }, []);

  // Handle submit to MongoDB
  const handleSubmit = useCallback(async () => {
    if (!pipelineOutput) return;

    setState("submitting");
    setError(null);

    try {
      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_output: pipelineOutput,
          reviewed_metrics: metrics,
          reviewer: "local_user",
          reviewer_notes: null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Submit failed");
      }

      setState("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("reviewing");
    }
  }, [pipelineOutput, metrics]);

  // Reset to start over
  const handleReset = useCallback(() => {
    setState("idle");
    setPipelineOutput(null);
    setMetrics([]);
    setError(null);
    setActionedMetrics(new Set());
  }, []);

  // Flagged metrics that haven't been actioned yet (still need attention)
  // Exclude hidden metadata fields like _flags
  const pendingFlaggedMetrics = metrics.filter(
    (m) => m.flags.length > 0 && !actionedMetrics.has(m.metric) && !HIDDEN_FIELDS.includes(m.metric)
  );

  // Group metrics by category for organized display
  // Include: unflagged metrics + actioned flagged metrics
  const metricsByCategory = useMemo(() => {
    const grouped: Record<string, ExtractionMetric[]> = {};
    for (const [category, fields] of Object.entries(FIELD_CATEGORIES)) {
      const categoryMetrics = fields
        .map((f) => metrics.find((m) => m.metric === f))
        .filter((m): m is ExtractionMetric => m !== undefined);
      if (categoryMetrics.length > 0) {
        grouped[category] = categoryMetrics;
      }
    }
    return grouped;
  }, [metrics]);

  // Live validation - recalculates whenever metrics change
  const liveValidationResults = useMemo(() => {
    if (metrics.length === 0) return [];
    return runValidation(metrics);
  }, [metrics]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">
            Lease Extraction Pipeline
          </h1>
          {state !== "idle" && (
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Idle State - File Upload */}
        {state === "idle" && (
          <FileUpload onUpload={handleFileUpload} />
        )}

        {/* Processing State */}
        {(state === "uploading" || state === "processing") && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
            <p className="text-gray-600 mb-4">
              {state === "uploading" ? "Uploading PDF..." : "Extracting lease data... This may take 1-2 minutes."}
            </p>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Cancel and start over
            </button>
          </div>
        )}

        {/* Reviewing State */}
        {state === "reviewing" && pipelineOutput && (
          <div className="space-y-6">
            {/* Document Header */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {pipelineOutput.filename}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {pipelineOutput.document_type} Lease · {pipelineOutput.page_count} pages
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pendingFlaggedMetrics.length > 0 ? (
                    <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                      {pendingFlaggedMetrics.length} items need attention
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                      Ready to submit
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Content - 2 columns */}
              <div className="lg:col-span-2 space-y-6">
                {/* Needs Attention Section - only shows un-actioned flagged items */}
                {pendingFlaggedMetrics.length > 0 && (
                  <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
                    <h3 className="text-sm font-semibold text-yellow-800 mb-1 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Needs Your Attention ({pendingFlaggedMetrics.length})
                    </h3>
                    <p className="text-xs text-yellow-700 mb-4">
                      Review and approve or override. Items will move to their category below once actioned.
                    </p>
                    <div className="space-y-3">
                      {pendingFlaggedMetrics.map((metric) => (
                        <MetricCard
                          key={metric.metric}
                          metric={metric}
                          onOverride={handleOverride}
                          onApprove={handleApprove}
                          onRevert={handleRevert}
                          expanded={true}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Categorized Fields - includes unflagged + actioned flagged metrics */}
                {Object.entries(metricsByCategory).map(([category, categoryMetrics]) => {
                  // Show: unflagged metrics OR actioned flagged metrics
                  const visibleInCategory = categoryMetrics.filter(
                    (m) => m.flags.length === 0 || actionedMetrics.has(m.metric)
                  );
                  if (visibleInCategory.length === 0) return null;

                  return (
                    <div key={category}>
                      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-400 rounded-full" />
                        {category}
                      </h3>
                      <div className="space-y-2">
                        {visibleInCategory.map((metric) => (
                          <MetricCard
                            key={metric.metric}
                            metric={metric}
                            onOverride={handleOverride}
                            onApprove={handleApprove}
                            onRevert={handleRevert}
                            expanded={false}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sidebar - Validation & Submit */}
              <div className="space-y-4">
                <ValidationPanel results={liveValidationResults} />

                {/* Summary Card */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total fields</span>
                      <span className="font-medium">{metrics.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Modified</span>
                      <span className="font-medium text-blue-600">
                        {metrics.filter((m) => m.override !== null).length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Pending review</span>
                      <span className={`font-medium ${pendingFlaggedMetrics.length > 0 ? "text-yellow-600" : "text-green-600"}`}>
                        {pendingFlaggedMetrics.length}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Reviewed</span>
                      <span className="font-medium text-green-600">{actionedMetrics.size}</span>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Submit to Database
                </button>
                <p className="text-xs text-gray-500 text-center">
                  Data will be saved to MongoDB with full audit trail
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Submitting State */}
        {state === "submitting" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
            <p className="text-gray-600">Saving to database...</p>
          </div>
        )}

        {/* Submitted State */}
        {state === "submitted" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Lease Saved Successfully</h2>
            <p className="text-gray-600 mb-6">The reviewed data has been saved to MongoDB.</p>
            <button
              onClick={handleReset}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Process Another Lease
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
