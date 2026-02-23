"use client";

import { useState } from "react";
import type { ExtractionMetric } from "@/schema/types";

interface MetricCardProps {
  metric: ExtractionMetric;
  onOverride: (metricName: string, newValue: string | number | boolean | null) => void;
  onApprove: (metricName: string) => void;
  onRevert: (metricName: string) => void;
  expanded?: boolean;
  isApproved?: boolean;
}

export function MetricCard({ metric, onOverride, onApprove, onRevert, expanded = false, isApproved = false }: MetricCardProps) {
  const [isExpanded, setIsExpanded] = useState(expanded && !isApproved);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const hasFlagged = metric.flags.length > 0;
  const hasOverride = metric.override !== null;
  const displayValue = metric.override ?? metric.value;

  // Format value for display
  const formatValue = (value: string | number | boolean | null): string => {
    if (value === null) return "(null)";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") {
      // Format currency for rent/deposit fields
      if (metric.metric.includes("rent") || metric.metric.includes("deposit")) {
        return `$${value.toLocaleString()}`;
      }
      // Format percentage for escalations and pro_rata
      if (metric.metric === "rent_escalations" && value < 1) {
        return `${(value * 100).toFixed(1)}%`;
      }
      if (metric.metric === "suite_pro_rata_share") {
        return `${(value * 100).toFixed(2)}%`;
      }
      return value.toLocaleString();
    }
    return String(value);
  };

  // Format field name for display
  const formatFieldName = (name: string): string => {
    return name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace("Sf", "SF")
      .replace("Rofo", "ROFO")
      .replace("Rofr", "ROFR");
  };

  // Start editing
  const handleStartEdit = () => {
    setEditValue(displayValue === null ? "" : String(displayValue));
    setIsEditing(true);
  };

  // Save edit
  const handleSaveEdit = () => {
    let newValue: string | number | boolean | null = editValue;

    // Parse value based on type
    if (editValue === "" || editValue.toLowerCase() === "null") {
      newValue = null;
    } else if (editValue.toLowerCase() === "true" || editValue.toLowerCase() === "yes") {
      newValue = true;
    } else if (editValue.toLowerCase() === "false" || editValue.toLowerCase() === "no") {
      newValue = false;
    } else if (!isNaN(Number(editValue.replace(/[$,%]/g, "")))) {
      const numStr = editValue.replace(/[$,%]/g, "");
      // If it looks like a percentage (e.g., "3%"), convert to decimal
      if (editValue.includes("%") && !metric.metric.includes("share")) {
        newValue = Number(numStr) / 100;
      } else {
        newValue = Number(numStr);
      }
    }

    onOverride(metric.metric, newValue);
    setIsEditing(false);
  };

  // Cancel edit
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue("");
  };

  return (
    <div
      className={`bg-white rounded-lg border ${
        hasFlagged ? "border-yellow-300" : "border-gray-200"
      } overflow-hidden`}
    >
      {/* Header - always visible */}
      <div
        className={`px-4 py-3 flex items-center justify-between cursor-pointer ${
          hasFlagged ? "bg-yellow-50" : ""
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <span
            className={`w-2 h-2 rounded-full ${
              hasOverride
                ? "bg-blue-500"
                : hasFlagged
                ? "bg-yellow-400"
                : "bg-green-400"
            }`}
          />

          {/* Field name */}
          <span className="font-medium text-gray-900">
            {formatFieldName(metric.metric)}
          </span>

          {/* Override badge */}
          {hasOverride && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
              Modified
            </span>
          )}
        </div>

        {/* Value preview */}
        <div className="flex items-center gap-3">
          <span className="text-gray-700 font-mono text-sm">
            {formatValue(displayValue)}
          </span>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {/* Source blurb */}
          {metric.source_blurb && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1">Source:</p>
              <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded italic">
                "{metric.source_blurb}"
              </p>
            </div>
          )}

          {/* Flags */}
          {metric.flags.length > 0 && (
            <div className="mt-3 space-y-1">
              {metric.flags.map((flag, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-yellow-700"
                >
                  <svg
                    className="w-4 h-4 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <span>{flag}</span>
                </div>
              ))}
            </div>
          )}

          {/* Edit controls */}
          <div className="mt-4 flex items-center gap-2">
            {isEditing ? (
              <>
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveEdit();
                    if (e.key === "Escape") handleCancelEdit();
                  }}
                />
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-gray-600 text-sm hover:text-gray-800"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleStartEdit}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                >
                  Override
                </button>
                {hasOverride ? (
                  <button
                    onClick={() => onRevert(metric.metric)}
                    className="px-3 py-1.5 text-red-600 text-sm hover:text-red-800"
                  >
                    Revert to Original
                  </button>
                ) : (
                  <button
                    onClick={() => onApprove(metric.metric)}
                    className={`px-3 py-1.5 text-sm rounded ${
                      hasFlagged
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : "border border-green-300 text-green-700 hover:bg-green-50"
                    }`}
                  >
                    Approve
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
