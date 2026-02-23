"use client";

import type { ValidationResult } from "@/schema/types";

interface ValidationPanelProps {
  results: ValidationResult[];
}

export function ValidationPanel({ results }: ValidationPanelProps) {
  if (results.length === 0) return null;

  const getStatusIcon = (status: ValidationResult["status"]) => {
    switch (status) {
      case "PASS":
        return (
          <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "FAIL":
        return (
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case "FLAG":
        return (
          <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case "SKIP":
        return (
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        );
    }
  };

  const formatCheckName = (check: string): string => {
    return check
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const flagged = results.filter((r) => r.status === "FLAG").length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-900">Validation Checks</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-green-600">{passed} passed</span>
          {failed > 0 && <span className="text-red-600">{failed} failed</span>}
          {flagged > 0 && <span className="text-yellow-600">{flagged} flagged</span>}
        </div>
      </div>

      <div className="space-y-3">
        {results.map((result) => (
          <div
            key={result.check}
            className={`flex items-start gap-3 p-3 rounded-lg ${
              result.status === "FAIL"
                ? "bg-red-50"
                : result.status === "FLAG"
                ? "bg-yellow-50"
                : "bg-gray-50"
            }`}
          >
            {getStatusIcon(result.status)}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {formatCheckName(result.check)}
              </p>
              <p className="text-sm text-gray-600 mt-0.5">{result.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
