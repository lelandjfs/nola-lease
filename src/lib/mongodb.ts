/**
 * MongoDB client singleton for lease extraction pipeline.
 * Uses connection pooling for efficient reuse across requests.
 */

import { MongoClient, Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB = process.env.MONGODB_DB || "lease_extraction";

// Module-level cache for connection reuse
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

/**
 * Get a connection to the MongoDB database.
 * Reuses existing connection if available.
 */
export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  // Return cached connection if available
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  // Create new connection with Atlas-compatible options
  // Note: For Node 24+, we use minimal TLS config to avoid OpenSSL 3.x issues
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  await client.connect();
  const db = client.db(MONGODB_DB);

  // Cache for reuse
  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

/**
 * Get the leases collection.
 */
export async function getLeasesCollection() {
  const { db } = await connectToDatabase();
  return db.collection("leases");
}

/**
 * Generate a lease document ID from property and tenant name.
 */
export function generateLeaseId(property: string, tenantName: string): string {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

  return `lease_${normalize(tenantName)}_${normalize(property)}`;
}
