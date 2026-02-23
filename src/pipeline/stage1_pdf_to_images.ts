/**
 * Stage 1: PDF to Page Images
 *
 * Converts PDF pages to high-quality images for vision model processing.
 * Uses pdfjs-dist (Mozilla PDF.js) for pure JavaScript PDF rendering.
 * Works on Vercel serverless without system dependencies.
 */

// Polyfill browser APIs FIRST, before any other imports (required by pdfjs-dist)
/* eslint-disable @typescript-eslint/no-require-imports */
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = require("dommatrix").DOMMatrix;
}
if (typeof globalThis.Path2D === "undefined") {
  const canvas = require("canvas");
  globalThis.Path2D = canvas.Path2D;
}
/* eslint-enable @typescript-eslint/no-require-imports */

import * as fs from "fs/promises";
import { PageImage } from "@/schema/types";

// Dynamic import for pdfjs-dist to handle ESM/CJS
let pdfjsLib: typeof import("pdfjs-dist");

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
  }
  return pdfjsLib;
}

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
  const pdfjs = await getPdfJs();

  // Load PDF document
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDoc = await loadingTask.promise;
  const pageImages: PageImage[] = [];

  // Dynamically import canvas for Node.js rendering
  const { createCanvas } = await import("canvas");

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: opts.scale });

    // Create canvas for rendering
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    // Render page to canvas
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderContext: any = {
      canvasContext: context,
      viewport,
    };
    await page.render(renderContext).promise;

    // Convert canvas to base64
    let base64: string;
    if (opts.format === "png") {
      const buffer = canvas.toBuffer("image/png");
      base64 = buffer.toString("base64");
    } else {
      const buffer = canvas.toBuffer("image/jpeg", {
        quality: opts.jpegQuality / 100,
      });
      base64 = buffer.toString("base64");
    }

    pageImages.push({
      pageNumber: pageNum,
      base64,
      format: opts.format,
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
  const pdfjs = await getPdfJs();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
  });

  const pdfDoc = await loadingTask.promise;
  return pdfDoc.numPages;
}
