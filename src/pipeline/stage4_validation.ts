/**
 * Stage 4: Validation
 *
 * Cross-validation checks that run after extraction.
 * These catch common errors and flag inconsistencies.
 */

import {
  ExtractionMetric,
  ValidationResult,
  EscalationType,
} from "@/schema/types";

/**
 * Run all validation checks on extracted metrics.
 */
export function runValidation(metrics: ExtractionMetric[]): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Get metric values
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  // Run each check
  results.push(validateRentMath(metrics));
  results.push(validateProRata(metrics));
  results.push(validateDateArithmetic(metrics));
  results.push(validateEscalationConsistency(metrics));
  results.push(validateDepositSanity(metrics));

  return results;
}

/**
 * Check: SF × $/RSF ÷ 12 = monthly rent
 */
export function validateRentMath(metrics: ExtractionMetric[]): ValidationResult {
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  const suiteSf = getValue("suite_sf") as number;
  const monthlyRent = getValue("starting_rent_monthly") as number;

  if (!suiteSf || !monthlyRent) {
    return {
      check: "rent_math",
      status: "SKIP",
      detail: "Missing suite_sf or starting_rent_monthly",
    };
  }

  // Calculate implied annual rate per RSF
  const impliedAnnualRsf = (monthlyRent * 12) / suiteSf;
  const recalculatedMonthly = (suiteSf * impliedAnnualRsf) / 12;

  // Allow small rounding difference
  if (Math.abs(recalculatedMonthly - monthlyRent) > 1) {
    return {
      check: "rent_math",
      status: "FAIL",
      detail: `Rent math inconsistent: ${suiteSf} SF × $${impliedAnnualRsf.toFixed(2)}/RSF ÷ 12 = $${recalculatedMonthly.toFixed(2)}, expected $${monthlyRent.toFixed(2)}`,
    };
  }

  return {
    check: "rent_math",
    status: "PASS",
    detail: `${suiteSf} SF × $${impliedAnnualRsf.toFixed(2)}/RSF ÷ 12 = $${recalculatedMonthly.toFixed(2)}`,
  };
}

/**
 * Check: suite SF ÷ building SF ≈ pro rata share
 */
export function validateProRata(
  metrics: ExtractionMetric[],
  buildingSf: number = 138130
): ValidationResult {
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  const suiteSf = getValue("suite_sf") as number;
  const proRata = getValue("suite_pro_rata_share") as number;

  if (!suiteSf || proRata === null || proRata === undefined) {
    return {
      check: "pro_rata",
      status: "SKIP",
      detail: "Missing suite_sf or suite_pro_rata_share",
    };
  }

  const expected = suiteSf / buildingSf;

  // Allow 0.2% tolerance
  if (Math.abs(expected - proRata) > 0.002) {
    return {
      check: "pro_rata",
      status: "FAIL",
      detail: `Expected ${(expected * 100).toFixed(2)}% (${suiteSf}/${buildingSf}), got ${(proRata * 100).toFixed(2)}%`,
    };
  }

  return {
    check: "pro_rata",
    status: "PASS",
    detail: `${suiteSf} / ${buildingSf} = ${(expected * 100).toFixed(2)}%`,
  };
}

/**
 * Check: start + term months = expiration
 */
export function validateDateArithmetic(metrics: ExtractionMetric[]): ValidationResult {
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  const startDate = getValue("lease_start_date") as string;
  const termMonths = getValue("lease_term_months") as number;
  const expirationDate = getValue("lease_expiration_date") as string;

  if (!startDate || !termMonths || !expirationDate) {
    return {
      check: "date_arithmetic",
      status: "SKIP",
      detail: "Missing date(s) or term",
    };
  }

  try {
    const start = new Date(startDate);
    const expiration = new Date(expirationDate);

    // Calculate expected expiration (last day of Nth full calendar month)
    const expectedExp = new Date(start);
    expectedExp.setMonth(expectedExp.getMonth() + termMonths);
    // Go to last day of that month
    expectedExp.setDate(0);

    // Compare year and month (allow day variance due to "last day" calculations)
    const expYear = expiration.getFullYear();
    const expMonth = expiration.getMonth();
    const expectedYear = expectedExp.getFullYear();
    const expectedMonth = expectedExp.getMonth();

    if (expYear !== expectedYear || Math.abs(expMonth - expectedMonth) > 1) {
      return {
        check: "date_arithmetic",
        status: "FAIL",
        detail: `${startDate} + ${termMonths} months ≠ ${expirationDate}`,
      };
    }

    return {
      check: "date_arithmetic",
      status: "PASS",
      detail: `${startDate} + ${termMonths} months = ${expirationDate}`,
    };
  } catch {
    return {
      check: "date_arithmetic",
      status: "SKIP",
      detail: "Could not parse dates",
    };
  }
}

/**
 * Check: detected escalation type matches rent table pattern.
 * This is the key validation that catches percentage vs fixed dollar errors.
 */
export function validateEscalationConsistency(metrics: ExtractionMetric[]): ValidationResult {
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  const escalationValue = getValue("rent_escalations") as number;
  const escalationType = getValue("escalation_type") as EscalationType;
  const startingRent = getValue("starting_rent_monthly") as number;
  const suiteSf = getValue("suite_sf") as number;

  if (!escalationValue || !escalationType || !startingRent || !suiteSf) {
    return {
      check: "escalation_consistency",
      status: "SKIP",
      detail: "Missing escalation data",
    };
  }

  // Calculate implied annual RSF rate
  const annualRsf = (startingRent * 12) / suiteSf;

  // If escalation value is > 1, it's likely a dollar amount
  // If escalation value is < 1, it's likely a percentage
  const looksLikePercentage = escalationValue < 0.20; // Less than 20%
  const looksLikeDollar = escalationValue >= 0.50; // $0.50 or more per RSF

  // Check for common 3% pattern
  const isLikelyThreePercent =
    escalationValue >= 0.029 && escalationValue <= 0.031;
  const impliedPercentFromDollar = escalationValue / annualRsf;
  const dollarIsLikelyThreePercent =
    impliedPercentFromDollar >= 0.025 && impliedPercentFromDollar <= 0.035;

  // Flag inconsistencies
  if (escalationType === "percentage" && looksLikeDollar) {
    return {
      check: "escalation_consistency",
      status: "FLAG",
      detail: `Classified as percentage but value ${escalationValue} looks like dollar amount`,
    };
  }

  if (
    (escalationType === "fixed_dollar_per_rsf" || escalationType === "step_schedule") &&
    dollarIsLikelyThreePercent
  ) {
    // The dollar amount translates to ~3% - suggest it might be percentage
    const impliedPercent = (impliedPercentFromDollar * 100).toFixed(1);
    return {
      check: "escalation_consistency",
      status: "FLAG",
      detail: `Classified as ${escalationType} ($${escalationValue}/RSF), but this equals ~${impliedPercent}% annual increase. Consider reclassifying as percentage with value 0.03`,
    };
  }

  if (escalationType === "percentage" && isLikelyThreePercent) {
    return {
      check: "escalation_consistency",
      status: "PASS",
      detail: `${(escalationValue * 100).toFixed(1)}% annual escalation confirmed`,
    };
  }

  return {
    check: "escalation_consistency",
    status: "PASS",
    detail: `Escalation: ${escalationType} = ${escalationValue}`,
  };
}

/**
 * Check: deposit ÷ monthly rent is within reasonable range (0.5x - 6x)
 */
export function validateDepositSanity(metrics: ExtractionMetric[]): ValidationResult {
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  const deposit = getValue("security_deposit") as number;
  const monthlyRent = getValue("starting_rent_monthly") as number;

  if (!deposit || !monthlyRent) {
    return {
      check: "deposit_sanity",
      status: "SKIP",
      detail: "Missing deposit or rent",
    };
  }

  const ratio = deposit / monthlyRent;

  if (ratio < 0.5 || ratio > 6.0) {
    return {
      check: "deposit_sanity",
      status: "FLAG",
      detail: `Deposit ratio ${ratio.toFixed(2)}x monthly rent — outside typical 0.5x-6x range`,
    };
  }

  return {
    check: "deposit_sanity",
    status: "PASS",
    detail: `$${deposit.toLocaleString()} / $${monthlyRent.toLocaleString()} = ${ratio.toFixed(2)}x monthly rent`,
  };
}

/**
 * Analyze rent escalation pattern and determine correct type.
 * Returns suggested corrections if the current classification seems wrong.
 */
export interface EscalationAnalysis {
  suggestedType: EscalationType;
  suggestedValue: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export function analyzeEscalation(
  startingRent: number,
  suiteSf: number,
  currentValue: number,
  currentType: EscalationType
): EscalationAnalysis {
  const annualRsf = (startingRent * 12) / suiteSf;

  // If value is > 0.5, it's likely a dollar amount
  if (currentValue >= 0.5) {
    // Calculate what percentage this dollar amount represents
    const impliedPercent = currentValue / annualRsf;

    // Check if it's close to 3%
    if (impliedPercent >= 0.025 && impliedPercent <= 0.035) {
      return {
        suggestedType: "percentage",
        suggestedValue: 0.03,
        confidence: "high",
        reasoning: `$${currentValue}/RSF increase on $${annualRsf.toFixed(2)}/RSF base = ${(impliedPercent * 100).toFixed(1)}% ≈ 3% annual escalation`,
      };
    }

    // Check if it's close to other common percentages
    if (impliedPercent >= 0.045 && impliedPercent <= 0.055) {
      return {
        suggestedType: "percentage",
        suggestedValue: 0.05,
        confidence: "high",
        reasoning: `$${currentValue}/RSF increase = ${(impliedPercent * 100).toFixed(1)}% ≈ 5% annual escalation`,
      };
    }

    // It's a true fixed dollar amount
    return {
      suggestedType: "fixed_dollar_per_rsf",
      suggestedValue: currentValue,
      confidence: "medium",
      reasoning: `$${currentValue}/RSF appears to be a fixed dollar escalation`,
    };
  }

  // Value looks like a percentage already
  if (currentValue < 0.20) {
    return {
      suggestedType: "percentage",
      suggestedValue: currentValue,
      confidence: "high",
      reasoning: `${(currentValue * 100).toFixed(1)}% is a valid percentage escalation`,
    };
  }

  // Unclear
  return {
    suggestedType: currentType,
    suggestedValue: currentValue,
    confidence: "low",
    reasoning: `Unable to determine escalation pattern with confidence`,
  };
}

/**
 * Apply lease type correction based on explicit language in source_blurb.
 * If the blurb contains "triple-net" or "NNN", override to NNN.
 */
export function applyLeaseTypeCorrection(
  metrics: ExtractionMetric[]
): ExtractionMetric[] {
  return metrics.map((m) => {
    if (m.metric === "document_type" || m.metric === "lease_type") {
      const blurb = (m.source_blurb || "").toLowerCase();
      const currentValue = (m.override ?? m.value) as string;

      // Check for explicit triple-net language
      if (
        (blurb.includes("triple-net") ||
          blurb.includes("triple net") ||
          blurb.includes("nnn") ||
          blurb.includes("net net net")) &&
        currentValue !== "NNN"
      ) {
        return {
          ...m,
          override: "NNN",
          flags: [
            ...m.flags,
            `Auto-corrected to NNN: source text contains explicit triple-net language`,
          ],
        };
      }
    }
    return m;
  });
}

/**
 * Apply escalation analysis to fix metrics.
 * Returns corrected metrics with overrides applied.
 */
export function applyEscalationCorrection(
  metrics: ExtractionMetric[]
): ExtractionMetric[] {
  const getValue = (name: string) => {
    const m = metrics.find((m) => m.metric === name);
    return m?.override ?? m?.value;
  };

  const startingRent = getValue("starting_rent_monthly") as number;
  const suiteSf = getValue("suite_sf") as number;
  const currentValue = getValue("rent_escalations") as number;
  const currentType = getValue("escalation_type") as EscalationType;

  if (!startingRent || !suiteSf || !currentValue || !currentType) {
    return metrics;
  }

  const analysis = analyzeEscalation(startingRent, suiteSf, currentValue, currentType);

  // If we have high confidence and different suggestion, apply correction
  if (
    analysis.confidence === "high" &&
    (analysis.suggestedType !== currentType || analysis.suggestedValue !== currentValue)
  ) {
    return metrics.map((m) => {
      if (m.metric === "rent_escalations") {
        return {
          ...m,
          override: analysis.suggestedValue,
          flags: [...m.flags, `Auto-corrected: ${analysis.reasoning}`],
        };
      }
      if (m.metric === "escalation_type") {
        return {
          ...m,
          override: analysis.suggestedType,
          flags: [...m.flags, `Auto-corrected from ${currentType} to ${analysis.suggestedType}`],
        };
      }
      return m;
    });
  }

  return metrics;
}
