/**
 * Stage 1: PDF to Page Images
 *
 * Converts PDF pages to high-quality images for vision model processing.
 * Uses Poppler's pdftoppm for reliable rendering.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { PageImage } from "@/schema/types";

const execAsync = promisify(exec);

/** Configuration for PDF rendering */
export interface RenderOptions {
  /** DPI for rendering (default: 200, good balance of quality/size) */
  dpi?: number;
  /** Output format (default: png) */
  format?: "png" | "jpeg";
  /** JPEG quality if format is jpeg (default: 90) */
  jpegQuality?: number;
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  dpi: 150,  // Reduced from 200 to keep payload size manageable
  format: "jpeg",  // JPEG is much smaller than PNG
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

  // Verify file exists
  try {
    await fs.access(pdfPath);
  } catch {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  // Create temp directory for output images
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lease-pdf-"));

  try {
    // Build pdftoppm command
    const outputPrefix = path.join(tempDir, "page");
    const formatFlag = opts.format === "png" ? "-png" : "-jpeg";

    let cmd = `pdftoppm ${formatFlag} -r ${opts.dpi}`;
    if (opts.format === "jpeg") {
      cmd += ` -jpegopt quality=${opts.jpegQuality}`;
    }
    cmd += ` "${pdfPath}" "${outputPrefix}"`;

    // Execute pdftoppm
    await execAsync(cmd);

    // Read generated images
    const files = await fs.readdir(tempDir);
    // pdftoppm uses .jpg extension for jpeg format
    const extension = opts.format === "jpeg" ? "jpg" : opts.format;
    const imageFiles = files
      .filter((f) => f.startsWith("page-") && f.endsWith(`.${extension}`))
      .sort((a, b) => {
        // Sort by page number (page-01.png, page-02.png, etc.)
        const numA = parseInt(a.match(/page-(\d+)/)?.[1] ?? "0");
        const numB = parseInt(b.match(/page-(\d+)/)?.[1] ?? "0");
        return numA - numB;
      });

    const pageImages: PageImage[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const filePath = path.join(tempDir, imageFiles[i]);
      const imageBuffer = await fs.readFile(filePath);
      const base64 = imageBuffer.toString("base64");

      // Get image dimensions (simple approach using file size heuristics)
      // In production, you might want to use sharp or similar to get exact dimensions
      const stats = await fs.stat(filePath);

      pageImages.push({
        pageNumber: i + 1,
        base64,
        format: opts.format,
        // Approximate dimensions based on DPI and standard letter size
        // Actual dimensions would require image parsing
        width: Math.round(8.5 * opts.dpi),
        height: Math.round(11 * opts.dpi),
      });
    }

    return pageImages;
  } finally {
    // Cleanup temp directory
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        await fs.unlink(path.join(tempDir, file));
      }
      await fs.rmdir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get the number of pages in a PDF without rendering.
 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`pdfinfo "${pdfPath}" | grep "^Pages:"`);
    const match = stdout.match(/Pages:\s+(\d+)/);
    return match ? parseInt(match[1]) : 0;
  } catch {
    // Fallback: render and count (slower)
    const images = await pdfToImages(pdfPath);
    return images.length;
  }
}

/**
 * Convert PDF bytes (from memory) to page images.
 * Writes to temp file, processes, then cleans up.
 */
export async function pdfBytesToImages(
  pdfBytes: Buffer,
  options: RenderOptions = {}
): Promise<PageImage[]> {
  // Write bytes to temp file
  const tempPdf = path.join(os.tmpdir(), `lease-${Date.now()}.pdf`);

  try {
    await fs.writeFile(tempPdf, pdfBytes);
    return await pdfToImages(tempPdf, options);
  } finally {
    // Cleanup
    try {
      await fs.unlink(tempPdf);
    } catch {
      // Ignore cleanup errors
    }
  }
}
