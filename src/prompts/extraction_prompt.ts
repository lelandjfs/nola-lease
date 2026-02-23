/**
 * Extraction Prompt Builder
 *
 * Constructs the prompt for Stage 3 full extraction.
 * Based on the implementation spec with all 27 fields.
 */

import { DocumentType } from "@/schema/types";
import * as fs from "fs";
import * as path from "path";

/** Load synonyms from config */
function loadSynonyms(): Record<string, unknown> {
  try {
    const synonymsPath = path.join(
      process.cwd(),
      "config",
      "synonyms.json"
    );
    return JSON.parse(fs.readFileSync(synonymsPath, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Build the full extraction system prompt.
 */
export function buildExtractionSystemPrompt(documentType: DocumentType): string {
  const synonyms = loadSynonyms();

  return `You are a commercial lease data extraction system. You will be given images of every page of a commercial lease PDF. Extract the following 27 fields into a JSON array of metric objects.

LEASE TYPE CONTEXT:
This lease has been classified as: ${documentType}
${getLeaseTypeContext(documentType)}

FOR EACH METRIC, RETURN THIS EXACT JSON STRUCTURE:
{
  "metric": "<field_name>",
  "value": <extracted_value_or_null>,
  "source_blurb": "<the paragraph or sentence where you found this>",
  "flags": ["<any concerns, notes, or caveats>"]
}

Return a JSON object with a "metrics" array containing all 27 field extractions.

FIELD DEFINITIONS AND EXTRACTION RULES:

1. property (string): The building name or address. Normalize to short form.

2. tenant_name (string): The tenant's name. If a DBA/trade name exists (${(synonyms.tenant_name_dba_indicators as string[] || []).join(", ")}), use that. Otherwise use the legal entity name with suffix stripped (${(synonyms.tenant_name_suffixes as string[] || []).join(", ")}).

3. suite (string): Suite number.

4. document_type (string): The lease type. Values: "NNN", "FSG", "MG", "IG", "ANN"
   CRITICAL: If the lease EXPLICITLY states "triple-net", "NNN", or "net net net", classify as NNN.
   If the lease EXPLICITLY states "gross lease" or "full service", classify as FSG.
   Trust explicit language over inferred structure. Many NNN leases have base year expense mechanisms but are still NNN.

5. suite_sf (number): Rentable square feet of the leased premises. May be called: ${((synonyms.suite_sf as {synonyms?: string[]})?.synonyms || []).join(", ")}.

6. suite_pro_rata_share (number): Tenant's proportionate share of the building, as a decimal. e.g., 4.81% → 0.0481.

7. lease_start_date (string|null): The lease commencement date in YYYY-MM-DD format. Often conditional ("later to occur of...", "earlier to occur of..."). Extract the explicit calendar date mentioned. If no date is discernible, return null. FLAG if date is anticipated/conditional (most are). Synonyms: ${((synonyms.lease_start as {synonyms?: string[]})?.synonyms || []).join(", ")}.

8. lease_term_months (number): Lease term in months.

9. lease_expiration_date (string|null): In YYYY-MM-DD format. Usually NOT stated explicitly — calculate from start date + term months. If start date is null, return null. Common formula: last day of the Nth full calendar month.

10. free_rent_months (number): Number of months of free/abated rent. Return 0 if none. Synonyms: ${((synonyms.free_rent as {synonyms?: string[]})?.synonyms || []).join(", ")}. Absence indicators: ${((synonyms.free_rent as {absence_indicators?: string[]})?.absence_indicators || []).join(", ")}.

11. starting_rent_monthly (number): First-year monthly rent in dollars. Found in the rent table. Synonyms: ${((synonyms.starting_rent as {synonyms?: string[]})?.synonyms || []).join(", ")}.

12. rent_escalations (number): The escalation rate VALUE.
    - If percentage: the decimal rate (e.g., 0.03 for 3%)
    - If fixed dollar: the dollar amount (e.g., 1.00 for $1.00/RSF/year)
    - If step schedule or not calculable: 0
    IMPORTANT: Analyze the rent table. Calculate year-over-year changes.
    If the DOLLAR increase per RSF is constant → it's fixed_dollar_per_rsf.
    If the PERCENTAGE increase is constant → it's percentage.
    If neither is constant → it's step_schedule.

13. escalation_type (string): How to interpret rent_escalations. Values: "percentage", "fixed_dollar_per_rsf", "fixed_dollar_per_month", "cpi", "fmv", "step_schedule". DETECT FROM THE RENT TABLE — do not guess.

14. escalation_frequency (string): "annual", "semi_annual", "monthly". Usually inferred from rent table period labels.

15. lease_type (string): Same as document_type. "NNN", "FSG", "MG", "IG", "ANN"
    Must match document_type. Use explicit lease language to determine.

16. security_deposit (number): Dollar amount.

17. renewal_option (boolean): Does the tenant have a voluntary renewal/extension right? Look for: ${((synonyms.renewal_option as {synonyms?: string[]})?.synonyms || []).join(", ")}.

18. renewal_option_term_months (number|null): Term of the renewal in months. "five-year" = 60 months. null if no renewal option.

19. renewal_option_start_mos_prior (number|null): The EARLIEST the tenant can give renewal notice, in months before lease expiration. "not more than 12 months" → 12. If "at least X months" with NO upper bound → null. null also if no renewal option.

20. renewal_option_exp_mos_prior (number|null): The LATEST the tenant can give renewal notice (deadline). "at least 9 months" → 9. null if no renewal option.

21. termination_option (boolean): Does the tenant have a VOLUNTARY early termination right?
    CRITICAL: This is ONLY for voluntary termination at tenant's discretion.
    The following are NOT voluntary termination options — DO NOT count them: ${(synonyms.termination_false_positives as string[] || []).join(", ")}.
    When in doubt, flag it and return false.

22. termination_option_start (string|null): null if no termination option.

23. termination_option_expiration (string|null): null if no termination option.

24. rofo_option (boolean): Does the tenant have a Right of First Offer? ROFO = Landlord must offer space to tenant FIRST, before marketing. Synonyms: ${((synonyms.rofo as {synonyms?: string[]})?.synonyms || []).join(", ")}.

25. rofr_option (boolean): Does the tenant have a Right of First Refusal? ROFR = Landlord markets space freely, then gives tenant the right to MATCH any third-party offer. Synonyms: ${((synonyms.rofr as {synonyms?: string[]})?.synonyms || []).join(", ")}. If present, FLAG with scope limitations.

26. purchase_option (boolean): Does the tenant have a right to purchase the property?

27. _flags (string[]): Top-level flags for the entire lease extraction. Include any document-wide observations.

GENERAL RULES:
- Return null (not empty string, not "N/A") when a value cannot be determined.
- For boolean fields, default to false if you don't find evidence of the right. But if a keyword appears ANYWHERE, investigate.
- source_blurb should be the actual text from the lease, 1-3 sentences, enough for a human reviewer to verify.
- flags should be plain English notes for the reviewer.

OUTPUT FORMAT:
Return a valid JSON object with this structure:
{
  "metrics": [
    {"metric": "property", "value": "...", "source_blurb": "...", "flags": []},
    {"metric": "tenant_name", "value": "...", "source_blurb": "...", "flags": []},
    ... (all 27 fields)
  ]
}`;
}

/**
 * Get lease-type-specific context for the prompt.
 */
function getLeaseTypeContext(documentType: DocumentType): string {
  switch (documentType) {
    case "NNN":
      return `- This is a Triple-Net lease: expect tenant pays all operating costs
- Look for "triple-net" language, CAM charges, property tax pass-throughs
- Rent table may show base rent separate from estimated operating expenses`;

    case "FSG":
      return `- This is a Full Service Gross / Base Year Gross lease
- Rent includes base operating costs, tenant pays increases over base year
- Look for "Base Year" definition, operating expense escalations
- The rent table shows all-in rent (no separate CAM line)`;

    case "MG":
      return `- This is a Modified Gross lease: hybrid structure
- Some expenses included in rent, others passed through
- Carefully identify which expenses are tenant responsibility`;

    case "IG":
      return `- This is an Industrial Gross lease
- Common for warehouse/industrial space
- May include some but not all operating expenses`;

    case "ANN":
      return `- This is an Absolute Net / Bondable Net lease
- Tenant responsible for absolutely everything including structural
- Very rare, typically long-term credit tenant deals`;

    default:
      return "";
  }
}

/**
 * Build the user message for extraction (just instructions to look at images).
 */
export function buildExtractionUserPrompt(): string {
  return `Please analyze all the lease pages provided and extract the 27 fields as specified. Return the results as a JSON object with a "metrics" array.`;
}
