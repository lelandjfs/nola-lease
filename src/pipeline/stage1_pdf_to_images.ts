/**
 * Stage 1: PDF to Page Images
 *
 * Converts PDF pages to high-quality images for vision model processing.
 * Uses unpdf for serverless-compatible PDF rendering.
 */

import * as fs from "fs/promises";
import { PageImage } from "@/schema/types";
import { renderPageAsImage, getDocumentProxy } from "unpdf";

/** Configuration for PDF rendering */
export interface RenderOptions {
  /** Scale factor for rendering (default: 2.0 for good quality) */
  scale?: number;
  /** Output format (default: jpeg) */
  format?: "png" | "jpeg";
  /** JPEG quality if format is jpeg (default: 85) */
  jpegQuality?: number;
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  scale: 2.0, // 2x scale for good OCR quality
  format: "jpeg",
  jpegQuality: 85,
};

/**
 * Convert a PDF file to an array of page images.
 *
 * @param pdfPath - Path to the PDF file
 * @param options - Rendering options
 * @returns Array of PageImage objects with base64-encoded image data
 */
export async function pdfToImages(
  pdfPath: string,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Read PDF file
  let pdfBytes: Buffer;
  try {
    pdfBytes = await fs.readFile(pdfPath);
  } catch {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  return pdfBytesToImages(pdfBytes, opts);
}

/**
 * Convert PDF bytes (from memory) to page images.
 */
export async function pdfBytesToImages(
  pdfBytes: Buffer,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Load PDF document using unpdf
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  const pageImages: PageImage[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    // Render page to image using unpdf with @napi-rs/canvas for Node.js
    const imageResult = await renderPageAsImage(pdf, pageNum, {
      scale: opts.scale,
      canvasImport: () => import("@napi-rs/canvas"),
    });

    // Convert to base64
    const base64 = Buffer.from(imageResult).toString("base64");

    // Get page dimensions (approximate based on scale)
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: opts.scale });

    pageImages.push({
      pageNumber: pageNum,
      base64,
      format: "png", // unpdf outputs PNG
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    });
  }

  return pageImages;
}

/**
 * Get the number of pages in a PDF without rendering.
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  return pdf.numPages;
}
