#!/usr/bin/env npx tsx
/**
 * CLI Entry Point for Lease Extraction
 *
 * Usage:
 *   npx tsx scripts/extract.ts <pdf_path>
 *   npx tsx scripts/extract.ts ./leases/my_lease.pdf
 *   npx tsx scripts/extract.ts ./leases/my_lease.pdf --json
 *   npx tsx scripts/extract.ts ./leases/my_lease.pdf --skip-extraction
 */

import * as path from "path";
import * as fs from "fs";
import { config } from "dotenv";

// Load environment variables
config();

// Import pipeline (after dotenv so env vars are available)
import {
  runPipeline,
  wasSkipped,
  printPipelineOutput,
  PipelineOptions,
} from "../src/pipeline";
import { PipelineOutput } from "../src/schema/types";

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));

  const showJson = flags.includes("--json");
  const skipExtraction = flags.includes("--skip-extraction");
  const help = flags.includes("--help") || flags.includes("-h");

  if (help || positional.length === 0) {
    console.log(`
Lease Extraction CLI

Usage:
  npx tsx scripts/extract.ts <pdf_path> [options]

Options:
  --json             Output raw JSON instead of formatted
  --skip-extraction  Only run stages 1-2 (PDF conversion + type detection)
  --help, -h         Show this help message

Examples:
  npx tsx scripts/extract.ts ./leases/my_lease.pdf
  npx tsx scripts/extract.ts ./leases/my_lease.pdf --json > output.json
  npx tsx scripts/extract.ts ./leases/my_lease.pdf --skip-extraction
`);
    process.exit(0);
  }

  const pdfPath = positional[0];

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(pdfPath)
    ? pdfPath
    : path.resolve(process.cwd(), pdfPath);

  // Check file exists
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ File not found: ${absolutePath}`);
    process.exit(1);
  }

  // Check it's a PDF
  if (!absolutePath.toLowerCase().endsWith(".pdf")) {
    console.error(`❌ File is not a PDF: ${absolutePath}`);
    process.exit(1);
  }

  // Build options
  const options: PipelineOptions = {
    skipExtraction,
  };

  try {
    // Run pipeline
    const result = await runPipeline(absolutePath, options);

    // Handle skipped documents
    if (wasSkipped(result)) {
      if (showJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n⏭️  Document skipped: ${result.reason}\n`);
      }
      process.exit(0);
    }

    // Output results
    if (showJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printPipelineOutput(result as PipelineOutput);
    }
  } catch (error) {
    console.error("\n❌ Pipeline error:");
    console.error(error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }

    process.exit(1);
  }
}

main();
