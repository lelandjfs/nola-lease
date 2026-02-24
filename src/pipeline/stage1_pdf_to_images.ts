/**
 * Stage 1: PDF to Page Images
 *
 * Converts PDF pages to high-quality images for vision model processing.
 * Uses CloudConvert API for serverless-compatible PDF rendering.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { PageImage } from "@/schema/types";

/** Configuration for PDF rendering */
export interface RenderOptions {
  /** DPI for rendering (default: 150) */
  dpi?: number;
  /** Output format (default: jpeg) */
  format?: "png" | "jpeg";
  /** JPEG quality if format is jpeg (default: 85) */
  jpegQuality?: number;
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  dpi: 150,
  format: "jpeg",
  jpegQuality: 85,
};

const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY;

/**
 * Convert PDF bytes to page images using CloudConvert API.
 */
export async function pdfBytesToImages(
  pdfBytes: Buffer,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!CLOUDCONVERT_API_KEY) {
    throw new Error("CLOUDCONVERT_API_KEY environment variable is required");
  }

  // Step 1: Create a job with upload, convert, and export tasks
  const jobResponse = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tasks: {
        "upload-pdf": {
          operation: "import/upload",
        },
        "convert-to-images": {
          operation: "convert",
          input: ["upload-pdf"],
          output_format: opts.format === "png" ? "png" : "jpg",
          engine: "poppler",
          pixel_density: opts.dpi,
          ...(opts.format === "jpeg" ? { quality: opts.jpegQuality } : {}),
        },
        "export-images": {
          operation: "export/url",
          input: ["convert-to-images"],
        },
      },
    }),
  });

  if (!jobResponse.ok) {
    const error = await jobResponse.text();
    throw new Error(`CloudConvert job creation failed: ${error}`);
  }

  const job = await jobResponse.json();
  const uploadTask = job.data.tasks.find(
    (t: { name: string }) => t.name === "upload-pdf"
  );

  if (!uploadTask?.result?.form) {
    throw new Error("Upload task not ready");
  }

  // Step 2: Upload the PDF
  const formData = new FormData();
  for (const [key, value] of Object.entries(uploadTask.result.form.parameters)) {
    formData.append(key, value as string);
  }
  formData.append("file", new Blob([pdfBytes]), "document.pdf");

  const uploadResponse = await fetch(uploadTask.result.form.url, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`PDF upload failed: ${uploadResponse.statusText}`);
  }

  // Step 3: Wait for job completion
  const jobId = job.data.id;
  let completedJob;

  for (let i = 0; i < 60; i++) {
    // Max 60 seconds wait
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const statusResponse = await fetch(
      `https://api.cloudconvert.com/v2/jobs/${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
        },
      }
    );

    completedJob = await statusResponse.json();

    if (completedJob.data.status === "finished") {
      break;
    } else if (completedJob.data.status === "error") {
      throw new Error(
        `CloudConvert job failed: ${JSON.stringify(completedJob.data.tasks)}`
      );
    }
  }

  if (completedJob?.data.status !== "finished") {
    throw new Error("CloudConvert job timed out");
  }

  // Step 4: Download the converted images
  const exportTask = completedJob.data.tasks.find(
    (t: { name: string }) => t.name === "export-images"
  );

  if (!exportTask?.result?.files) {
    throw new Error("No exported files found");
  }

  const pageImages: PageImage[] = [];

  // Sort files by name to ensure correct page order
  const files = exportTask.result.files.sort(
    (a: { filename: string }, b: { filename: string }) =>
      a.filename.localeCompare(b.filename, undefined, { numeric: true })
  );

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const imageResponse = await fetch(file.url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString("base64");

    pageImages.push({
      pageNumber: i + 1,
      base64,
      format: opts.format,
      width: Math.round(8.5 * opts.dpi), // Approximate
      height: Math.round(11 * opts.dpi),
    });
  }

  return pageImages;
}

/**
 * Convert a PDF file to page images.
 */
export async function pdfToImages(
  pdfPath: string,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  const pdfBytes = await fs.readFile(pdfPath);
  return pdfBytesToImages(pdfBytes, options);
}

/**
 * Get the number of pages in a PDF.
 * Note: This requires full conversion with CloudConvert.
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const images = await pdfToImages(pdfPath);
  return images.length;
}
