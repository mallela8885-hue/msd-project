/**
 * Database Migration Runner
 * Executes pending database migrations in order
 */

const mongoose = require("mongoose");
require("dotenv").config();

// Import migration classes
const SchemaMigration = require("../server/db/migrations/001_schema");
const AuthUpgradeMigration = require("../server/db/migrations/002_auth_upgrade");

const MIGRATIONS = [
  { name: "001_schema", migration: SchemaMigration },
  { name: "002_auth_upgrade", migration: AuthUpgradeMigration },
];

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✓ Connected to MongoDB");
  } catch (error) {
    console.error("✗ Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

async function runMigrations() {
  try {
    console.log("🚀 Starting database migrations...\n");

    for (const { name, migration } of MIGRATIONS) {
      console.log(`Running migration: ${name}`);
      console.log("─".repeat(50));
      
      try {
        if (migration.up) {
          await migration.up();
        } else {
          console.log("  ℹ️  Migration has no up() method");
        }
        console.log(`✓ ${name} completed successfully\n`);
      } catch (error) {
        console.error(`✗ ${name} failed:`, error.message);
        console.error("\nRolling back...");
        if (migration.down) {
          try {
            await migration.down();
            console.log("✓ Rollback completed");
          } catch (rollbackError) {
            console.error("✗ Rollback failed:", rollbackError.message);
          }
        }
        process.exit(1);
      }
    }

    console.log("=".repeat(50));
    console.log("✅ All migrations completed successfully!");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("❌ Migration runner failed:", error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

async function main() {
  await connectDB();
  await runMigrations();
}

main();
