/**
 * Next.js Instrumentation - runs before any other code
 * Used to set up polyfills for Node.js environment
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Polyfill DOMMatrix for pdfjs-dist canvas rendering
    // Use canvas package's DOMMatrix which is compatible
    if (typeof globalThis.DOMMatrix === "undefined") {
      const canvas = await import("canvas");
      (globalThis as Record<string, unknown>).DOMMatrix = canvas.DOMMatrix;
    }
  }
}
