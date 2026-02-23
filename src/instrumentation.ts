/**
 * Next.js Instrumentation - runs before any other code
 * Used to set up polyfills for Node.js environment
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Polyfill DOMMatrix for pdfjs-dist canvas rendering
    if (typeof globalThis.DOMMatrix === "undefined") {
      const DOMMatrix = (await import("dommatrix")).default;
      // @ts-expect-error - polyfilling global
      globalThis.DOMMatrix = DOMMatrix;
    }

    // Polyfill Path2D from canvas
    if (typeof globalThis.Path2D === "undefined") {
      const canvas = await import("canvas");
      // @ts-expect-error - polyfilling global
      globalThis.Path2D = canvas.Path2D;
    }
  }
}
