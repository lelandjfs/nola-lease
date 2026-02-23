/**
 * Stage 1: PDF to Text Extraction
 *
 * Extracts text from PDF pages for LLM processing.
 * Uses unpdf for serverless-compatible text extraction (no canvas needed).
 */

import * as fs from "fs/promises";
import { PageImage } from "@/schema/types";
import { extractText, getDocumentProxy } from "unpdf";

/** Configuration for PDF processing */
export interface RenderOptions {
  /** Scale factor (unused for text extraction, kept for API compatibility) */
  scale?: number;
  /** Output format (unused for text extraction) */
  format?: "png" | "jpeg";
  /** Quality (unused for text extraction) */
  jpegQuality?: number;
}

/**
 * Convert a PDF file to an array of page text content.
 * Returns PageImage objects with text in base64 for API compatibility.
 *
 * @param pdfPath - Path to the PDF file
 * @param options - Options (mostly unused, for API compatibility)
 * @returns Array of PageImage objects with base64-encoded text
 */
export async function pdfToImages(
  pdfPath: string,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  void options; // Unused but kept for API compatibility

  // Read PDF file
  let pdfBytes: Buffer;
  try {
    pdfBytes = await fs.readFile(pdfPath);
  } catch {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  return pdfBytesToImages(pdfBytes);
}

/**
 * Convert PDF bytes to page text content.
 */
export async function pdfBytesToImages(
  pdfBytes: Buffer,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  void options; // Unused

  // Extract text from all pages
  const { text, totalPages } = await extractText(new Uint8Array(pdfBytes), {
    mergePages: false, // Keep pages separate
  });

  const pageTexts: PageImage[] = [];

  // text is an array of page texts when mergePages is false
  const pages = Array.isArray(text) ? text : [text];

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i] || "";
    // Encode text as base64 for API compatibility
    const base64 = Buffer.from(pageText, "utf-8").toString("base64");

    pageTexts.push({
      pageNumber: i + 1,
      base64,
      format: "text" as "png", // Use text format (cast for type compatibility)
      width: 0,
      height: 0,
    });
  }

  // Ensure we have entries for all pages
  while (pageTexts.length < totalPages) {
    pageTexts.push({
      pageNumber: pageTexts.length + 1,
      base64: Buffer.from("", "utf-8").toString("base64"),
      format: "text" as "png",
      width: 0,
      height: 0,
    });
  }

  return pageTexts;
}

/**
 * Get the number of pages in a PDF without full extraction.
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  return pdf.numPages;
}
