# Lease Extraction Pipeline — Architecture & Logic

## Overview

This pipeline extracts structured data from commercial lease PDFs using a multi-stage approach combining vision models, LLM extraction, and rule-based validation.

```
PDF Input
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: PDF → Images                                      │
│  Tool: Poppler (pdftoppm)                                   │
│  Output: Page images (JPEG, 150 DPI)                        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: Lease Type Detection                              │
│  Model: GPT-4o (vision)                                     │
│  Input: Page 1 image                                        │
│  Output: NNN | FSG | MG | IG | ANN                          │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 3: Full Extraction                                   │
│  Model: Claude Sonnet 4.5                                   │
│  Input: All page images + lease type context                │
│  Output: 27 ExtractionMetric objects                        │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Stage 4: Validation & Auto-Correction                      │
│  Tool: Rule-based (no API cost)                             │
│  - Lease type correction (explicit language check)          │
│  - Escalation correction (% vs $ detection)                 │
│  - 5 cross-validation checks                                │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
Pipeline Output (ready for HITL review)
```

---

## Stage 1: PDF to Images

**File:** `src/pipeline/stage1_pdf_to_images.ts`

**Purpose:** Convert PDF pages to images for vision model processing.

**Why images instead of text extraction?**
- Handles both digital and scanned PDFs identically
- Preserves table formatting, signatures, annotations
- Vision models can read layout/structure context
- No dependency on PDF text layer quality

**Configuration:**
```typescript
{
  dpi: 150,        // Balance of quality vs payload size
  format: "jpeg",  // Smaller than PNG
  jpegQuality: 85
}
```

**Page Limit:** Max 25 pages processed (covers most lease content, avoids API payload limits)

**Tool:** Poppler's `pdftoppm` (installed via Homebrew)

---

## Stage 2: Lease Type Detection

**File:** `src/pipeline/stage2_lease_type.ts`

**Purpose:** Classify the lease type from page 1 to provide context for extraction.

**Model:** OpenAI GPT-4o (vision)

**Why GPT-4o for this stage?**
- Fast (~2 seconds)
- Only needs page 1
- Simple classification task
- Cost-effective for single-image analysis

**Classification Types:**

| Code | Full Name | Key Indicators |
|------|-----------|----------------|
| NNN | Triple-Net | "triple-net", tenant pays all expenses |
| FSG | Full Service Gross | "full service", base year structure |
| MG | Modified Gross | Hybrid expense structure |
| IG | Industrial Gross | Warehouse/industrial context |
| ANN | Absolute Net | Tenant responsible for everything |

**Critical Rule:** Explicit language takes priority. If document says "triple-net", classify as NNN regardless of perceived structure.

---

## Stage 3: Full Extraction

**File:** `src/pipeline/stage3_extraction.ts`

**Purpose:** Extract all 27 lease fields with source citations.

**Model:** Claude Sonnet 4.5

**Why Claude for extraction?**
- Superior at following complex JSON schemas
- Better reasoning about legal language nuances
- Handles long context well (25 pages of images)
- More accurate at distinguishing similar concepts (ROFO vs ROFR)

**Prompt Structure:**
```
SYSTEM: You are a lease extraction system. Here are 27 fields to extract...
        [Lease type context: This is a {NNN|FSG|...} lease]
        [Synonym dictionary for field matching]
        [Specific extraction rules per field]

USER:   [Page 1 image]
        [Page 2 image]
        ...
        [Page N image]
        Please extract all fields as JSON.
```

**Output Schema:**
```typescript
interface ExtractionMetric {
  metric: string;           // Field name (e.g., "tenant_name")
  value: any;               // Extracted value
  override: any | null;     // Human correction (null until reviewed)
  source_document: string;  // PDF filename
  source_blurb: string;     // Quote from lease for verification
  flags: string[];          // Concerns/notes for reviewer
}
```

**27 Fields Extracted:**

| Category | Fields |
|----------|--------|
| Identifiers | property, tenant_name, suite, document_type |
| Space | suite_sf, suite_pro_rata_share |
| Dates | lease_start_date, lease_term_months, lease_expiration_date |
| Rent | free_rent_months, starting_rent_monthly, rent_escalations, escalation_type, escalation_frequency |
| Financial | security_deposit, lease_type |
| Options | renewal_option, renewal_option_term_months, renewal_option_start_mos_prior, renewal_option_exp_mos_prior |
| Termination | termination_option, termination_option_start, termination_option_expiration |
| Rights | rofo_option, rofr_option, purchase_option |
| Metadata | _flags |

---

## Stage 4: Validation & Auto-Correction

**File:** `src/pipeline/stage4_validation.ts`

**Purpose:** Catch extraction errors using rule-based checks, apply auto-corrections.

**No API cost** — pure TypeScript logic.

### Auto-Corrections

#### 1. Lease Type Correction

**Problem:** Models sometimes classify based on structure (base year = FSG) even when lease explicitly says "triple-net".

**Solution:** Check `source_blurb` for explicit language:
```typescript
if (blurb.includes("triple-net") && currentValue !== "NNN") {
  override = "NNN";
  flags.push("Auto-corrected to NNN: explicit triple-net language");
}
```

#### 2. Escalation Type Correction

**Problem:** Model returns dollar amount ($1.21/RSF) when it's actually a 3% annual increase.

**Solution:** Calculate implied percentage:
```typescript
const annualRsf = (monthlyRent * 12) / suiteSf;  // e.g., $38/RSF
const impliedPercent = escalationValue / annualRsf;  // $1.14 / $38 = 3%

if (impliedPercent >= 0.025 && impliedPercent <= 0.035) {
  // It's ~3% — correct to percentage
  override_escalation_type = "percentage";
  override_rent_escalations = 0.03;
}
```

### 5 Validation Checks

| Check | Logic | Example |
|-------|-------|---------|
| **rent_math** | SF × $/RSF ÷ 12 = monthly | 2497 × $38 ÷ 12 = $7,907.17 |
| **pro_rata** | suite SF ÷ building SF = share | 2497 ÷ 138130 = 1.81% |
| **date_arithmetic** | start + term = expiration | 2024-09-01 + 40mo = 2027-12-31 |
| **escalation_consistency** | detected type matches pattern | $1.14/RSF on $38 base = 3% ✓ |
| **deposit_sanity** | deposit ÷ rent in 0.5x-6x range | $17,279 ÷ $7,907 = 2.19x ✓ |

---

## Model Provider Abstraction

**Files:** `src/lib/models/`

**Purpose:** Toggle between OpenAI and Claude per pipeline stage.

```typescript
interface PipelineModelConfig {
  vision: { provider: "openai", model: "gpt-4o" },
  classification: { provider: "openai", model: "gpt-4o-mini" },
  extraction: { provider: "anthropic", model: "claude-sonnet-4-5" },
  reasoning: { provider: "anthropic", model: "claude-sonnet-4-5" }
}
```

**Why different models for different stages?**

| Stage | Best Model | Reason |
|-------|------------|--------|
| Vision (page→text) | GPT-4o | Excellent document OCR |
| Classification | GPT-4o-mini | Simple task, cost-effective |
| Extraction | Claude | Better at complex JSON, legal reasoning |
| Validation reasoning | Claude | Stronger at explaining discrepancies |

---

## Synonym Dictionary

**File:** `config/synonyms.json`

**Purpose:** Flexible field matching across different lease templates.

```json
{
  "free_rent": {
    "synonyms": ["Abated Rent", "Rent Credit", "Rent Concession", "Rent Holiday"],
    "absence_indicators": ["Not Applicable", "N/A", "None"]
  },
  "tenant_name_dba_indicators": ["d/b/a", "doing business as", "a/k/a"],
  "termination_false_positives": ["casualty", "condemnation", "default", "breach"]
}
```

Loaded at prompt build time, not hardcoded.

---

## Data Flow Summary

```
PDF File
    │
    ├─► [pdftoppm] → Page Images (JPEG)
    │
    ├─► [GPT-4o] → Document Type (NNN)
    │
    ├─► [Claude] → 27 ExtractionMetrics
    │                  ├─ value: extracted data
    │                  ├─ source_blurb: quote
    │                  └─ flags: concerns
    │
    ├─► [Validation] → Auto-corrections applied
    │                  ├─ Lease type override
    │                  └─ Escalation override
    │
    └─► PipelineOutput
            ├─ filename
            ├─ document_type
            ├─ metrics[] (with overrides)
            ├─ validation_results[]
            └─ errors[]
```

---

## Scalability Considerations

### Current Performance

| Stage | Time | Bottleneck |
|-------|------|------------|
| PDF→Images | ~2s | Disk I/O |
| Type Detection | ~2s | API |
| Extraction | ~80s | API |
| Validation | <1s | CPU |
| **Total** | **~85s/doc** | API calls |

### Scaling Strategies

1. **Batch Processing**
   - Queue-based system (Bull, BullMQ, SQS)
   - Multiple workers processing in parallel
   - Respect API rate limits per worker

2. **Caching**
   - Cache PDF→Image conversions
   - Cache by document hash to skip re-extraction
   - Store results in MongoDB

3. **Selective Processing**
   - Smart page selection (first 10 + rent schedules)
   - Skip unchanged documents
   - Incremental extraction for amendments

4. **Cost Optimization**
   - Use GPT-4o-mini for simple classifications
   - Batch similar documents
   - Cache common patterns

---

## Error Handling

| Error Type | Handling |
|------------|----------|
| PDF read failure | Return error, skip document |
| API timeout | Retry with exponential backoff |
| JSON parse failure | Fallback regex parser |
| Missing fields | Add placeholders with flags |
| Validation failure | Flag for review, don't block |

---

## File Structure

```
lease-extraction/
├── src/
│   ├── pipeline/
│   │   ├── index.ts              # Orchestrator
│   │   ├── stage1_pdf_to_images.ts
│   │   ├── stage2_lease_type.ts
│   │   ├── stage3_extraction.ts
│   │   └── stage4_validation.ts
│   ├── prompts/
│   │   └── extraction_prompt.ts  # Prompt builder
│   ├── schema/
│   │   └── types.ts              # TypeScript interfaces
│   └── lib/
│       ├── config.ts             # Environment config
│       └── models/               # Model providers
│           ├── openai.ts
│           ├── anthropic.ts
│           └── index.ts
├── config/
│   └── synonyms.json
├── scripts/
│   └── extract.ts                # CLI entry point
└── leases/                       # Drop PDFs here
```

---

## Usage

```bash
# Extract a single lease
npm run extract ./leases/my_lease.pdf

# Output as JSON
npm run extract ./leases/my_lease.pdf --json > output.json

# Skip extraction (test stages 1-2 only)
npm run extract ./leases/my_lease.pdf --skip-extraction
```

---

## Next Steps

- [ ] Session 4: Review Interface (React UI for HITL)
- [ ] Session 5: MongoDB Persistence
- [ ] Session 6: Integration Testing
- [ ] Batch processing queue
- [ ] Amendment handling
