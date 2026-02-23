/**
 * MongoDB Setup Script
 * Creates the leases collection with schema validation and indexes.
 * Run with: npx ts-node scripts/setup-mongodb.ts
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI!;
const MONGODB_DB = process.env.MONGODB_DB || "lease_extraction";

// JSON Schema for lease documents - enforces consistency
const leaseSchema = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "_id",
      "property",
      "tenant_name",
      "suite",
      "document_type",
      "suite_sf",
      "lease_type",
      "_extraction",
    ],
    properties: {
      // Document ID (generated from tenant + property)
      _id: {
        bsonType: "string",
        description: "Unique lease identifier (e.g., lease_tenant_property)",
      },

      // === IDENTIFIERS ===
      property: {
        bsonType: "string",
        description: "Normalized building name",
      },
      tenant_name: {
        bsonType: "string",
        description: "Tenant DBA or legal name",
      },
      suite: {
        bsonType: "string",
        description: "Suite number",
      },
      document_type: {
        enum: ["NNN", "FSG", "MG", "IG", "ANN"],
        description: "Lease type classification",
      },

      // === SPACE ===
      suite_sf: {
        bsonType: "number",
        description: "Rentable square feet",
      },
      suite_pro_rata_share: {
        bsonType: "number",
        description: "Pro rata share as decimal (e.g., 0.0481 for 4.81%)",
      },

      // === DATES ===
      lease_start_date: {
        bsonType: ["string", "null"],
        description: "ISO date string or null",
      },
      lease_term_months: {
        bsonType: "number",
        description: "Lease term in months",
      },
      lease_expiration_date: {
        bsonType: ["string", "null"],
        description: "ISO date string or null",
      },

      // === RENT ===
      free_rent_months: {
        bsonType: "number",
        description: "Number of free rent months",
      },
      starting_rent_monthly: {
        bsonType: "number",
        description: "Starting monthly rent in dollars",
      },
      rent_escalations: {
        bsonType: "number",
        description: "Escalation value (e.g., 0.03 for 3%)",
      },
      escalation_type: {
        enum: [
          "percentage",
          "fixed_dollar_per_rsf",
          "fixed_dollar_per_month",
          "cpi",
          "fmv",
          "step_schedule",
        ],
        description: "How to interpret rent_escalations",
      },
      escalation_frequency: {
        enum: ["annual", "semi_annual", "monthly"],
        description: "How often escalations apply",
      },

      // === FINANCIAL ===
      security_deposit: {
        bsonType: "number",
        description: "Security deposit in dollars",
      },

      // === LEASE TYPE (duplicate for CSV compatibility) ===
      lease_type: {
        enum: ["NNN", "FSG", "MG", "IG", "ANN"],
        description: "Same as document_type",
      },

      // === OPTIONS ===
      renewal_option: {
        bsonType: "bool",
        description: "Has renewal option",
      },
      renewal_option_term_months: {
        bsonType: ["number", "null"],
        description: "Renewal term in months",
      },
      renewal_option_start_mos_prior: {
        bsonType: ["number", "null"],
        description: "Notice window start (months before expiration)",
      },
      renewal_option_exp_mos_prior: {
        bsonType: ["number", "null"],
        description: "Notice window end (months before expiration)",
      },
      termination_option: {
        bsonType: "bool",
        description: "Has voluntary termination option",
      },
      termination_option_start: {
        bsonType: ["string", "null"],
        description: "Termination option start date/description",
      },
      termination_option_expiration: {
        bsonType: ["string", "null"],
        description: "Termination option expiration date/description",
      },
      rofo_option: {
        bsonType: "bool",
        description: "Right of First Offer",
      },
      rofr_option: {
        bsonType: "bool",
        description: "Right of First Refusal",
      },
      purchase_option: {
        bsonType: "bool",
        description: "Purchase option",
      },

      // === PIPELINE METADATA ===
      _flags: {
        bsonType: "array",
        description: "Top-level flags for the lease",
        items: { bsonType: "string" },
      },

      // === EXTRACTION AUDIT TRAIL ===
      _extraction: {
        bsonType: "object",
        required: ["extracted_at", "source_document", "model", "human_reviewed"],
        properties: {
          extracted_at: {
            bsonType: "string",
            description: "ISO timestamp of extraction",
          },
          source_document: {
            bsonType: "string",
            description: "Original PDF filename",
          },
          model: {
            bsonType: "string",
            description: "Model used for extraction",
          },
          pipeline_version: {
            bsonType: "string",
            description: "Pipeline version identifier",
          },
          metrics: {
            bsonType: "array",
            description: "Full extraction metrics with source_blurbs",
          },
          validation_results: {
            bsonType: "array",
            description: "Cross-validation check results",
          },
          human_reviewed: {
            bsonType: "bool",
            description: "Whether a human reviewed this extraction",
          },
          reviewed_by: {
            bsonType: ["string", "null"],
            description: "Reviewer identifier (for OAuth)",
          },
          reviewed_at: {
            bsonType: ["string", "null"],
            description: "ISO timestamp of review",
          },
          approved_by: {
            bsonType: ["string", "null"],
            description: "OAuth user who approved (email or user ID)",
          },
          approved_at: {
            bsonType: ["string", "null"],
            description: "ISO timestamp of approval",
          },
          overrides_applied: {
            bsonType: "number",
            description: "Count of fields human changed",
          },
        },
      },
    },
  },
};

async function setupDatabase() {
  console.log("Connecting to MongoDB Atlas...");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected successfully!");

    const db = client.db(MONGODB_DB);

    // Check if collection exists
    const collections = await db.listCollections({ name: "leases" }).toArray();

    if (collections.length > 0) {
      console.log("Collection 'leases' already exists. Updating schema validation...");
      await db.command({
        collMod: "leases",
        validator: leaseSchema,
        validationLevel: "moderate", // Allows existing docs, validates new/updated
        validationAction: "error",
      });
    } else {
      console.log("Creating 'leases' collection with schema validation...");
      await db.createCollection("leases", {
        validator: leaseSchema,
        validationLevel: "moderate",
        validationAction: "error",
      });
    }

    console.log("Schema validation configured!");

    // Create indexes for common queries
    console.log("Creating indexes...");
    const leasesCollection = db.collection("leases");

    await leasesCollection.createIndex({ property: 1 }, { name: "idx_property" });
    await leasesCollection.createIndex({ tenant_name: 1 }, { name: "idx_tenant" });
    await leasesCollection.createIndex({ lease_type: 1 }, { name: "idx_lease_type" });
    await leasesCollection.createIndex({ lease_start_date: 1 }, { name: "idx_start_date" });
    await leasesCollection.createIndex({ lease_expiration_date: 1 }, { name: "idx_expiration" });
    await leasesCollection.createIndex(
      { "_extraction.extracted_at": -1 },
      { name: "idx_extracted_at" }
    );
    await leasesCollection.createIndex(
      { "_extraction.approved_by": 1 },
      { name: "idx_approved_by" }
    );

    // Compound index for property + tenant lookups
    await leasesCollection.createIndex(
      { property: 1, tenant_name: 1 },
      { name: "idx_property_tenant" }
    );

    console.log("Indexes created!");

    // Show summary
    const indexList = await leasesCollection.indexes();
    console.log("\nCollection 'leases' ready with indexes:");
    indexList.forEach((idx) => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log("\nDatabase setup complete!");
    console.log(`Database: ${MONGODB_DB}`);
    console.log("Collection: leases");
  } catch (error) {
    console.error("Setup failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

setupDatabase();
