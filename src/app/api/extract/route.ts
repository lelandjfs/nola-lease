import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { runPipeline, wasSkipped } from "@/pipeline";

// Use /tmp for Vercel serverless compatibility
const UPLOAD_DIR = os.tmpdir();

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "File must be a PDF" },
        { status: 400 }
      );
    }

    // Write file to temp location
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    tempFilePath = path.join(UPLOAD_DIR, `${Date.now()}_${file.name}`);
    await writeFile(tempFilePath, buffer);

    // Run the pipeline
    const result = await runPipeline(tempFilePath);

    // Check if skipped (e.g., amendment)
    if (wasSkipped(result)) {
      return NextResponse.json(
        { error: result.reason, skipped: true },
        { status: 422 }
      );
    }

    // Return pipeline output
    return NextResponse.json(result);
  } catch (error) {
    console.error("Extraction error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction failed" },
      { status: 500 }
    );
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// Route segment config for large PDF uploads
export const maxDuration = 60; // Allow up to 60 seconds for processing
