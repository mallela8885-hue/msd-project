/**
 * Authentication Upgrade Verification Script
 * Validates that the authentication system upgrades are properly implemented
 */

const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../server/models/User");
const AuthUpgradeMigration = require("../server/db/migrations/002_auth_upgrade");

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✓ Connected to MongoDB");
  } catch (error) {
    console.error("✗ Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

async function verifySchema() {
  console.log("\n📋 Verifying User Schema...");
  
  const schema = User.schema;
  
  // Check if required methods exist
  const requiredMethods = [
    'findByEmail',
    'findByGoogleId',
    'findByGithubId',
    'comparePassword',
    'isLocked',
    'incLoginAttempts',
    'resetLoginAttempts',
  ];

  const requiredInstanceMethods = [
    'hasProvider',
    'getLinkedProviders',
    'linkProvider',
  ];

  console.log("Checking static methods:");
  requiredMethods.forEach(method => {
    if (User[method]) {
      console.log(`  ✓ ${method}`);
    } else {
      console.log(`  ✗ ${method} - MISSING`);
    }
  });

  console.log("Checking instance methods:");
  requiredInstanceMethods.forEach(method => {
    if (schema.methods[method]) {
      console.log(`  ✓ ${method}`);
    } else {
      console.log(`  ✗ ${method} - MISSING`);
    }
  });
}

async function verifyIndexes() {
  console.log("\n📊 Verifying Database Indexes...");
  
  const indexes = await User.collection.getIndexes();
  
  const requiredIndexes = [
    { field: 'email_1', name: 'email unique index' },
    { field: 'oauth.google.id_1', name: 'Google ID unique index' },
    { field: 'oauth.github.id_1', name: 'GitHub ID unique index' },
  ];

  requiredIndexes.forEach(({ field, name }) => {
    if (indexes[field]) {
      console.log(`  ✓ ${name}`);
      if (indexes[field].unique) {
        console.log(`    → Unique constraint: YES`);
      }
      if (indexes[field].sparse) {
        console.log(`    → Sparse constraint: YES`);
      }
    } else {
      console.log(`  ✗ ${name} - MISSING`);
    }
  });
}

async function verifyTestScenarios() {
  console.log("\n🧪 Testing Authentication Scenarios...");

  try {
    // Clean up test data
    await User.deleteMany({ email: /^test-/ });

    // Scenario 1: Local signup
    console.log("\n1️⃣  Test: Local user registration");
    const localUser = new User({
      email: "test-local@example.com",
      password: "TestPassword123",
      name: "Test Local User",
      oauth: { google: {}, github: {} },
    });
    await localUser.save();
    console.log(`  ✓ Created local user: ${localUser._id}`);

    // Scenario 2: Duplicate email prevention
    console.log("\n2️⃣  Test: Duplicate email prevention");
    try {
      const duplicate = new User({
        email: "test-local@example.com",
        password: "AnotherPassword123",
        name: "Duplicate User",
      });
      await duplicate.save();
      console.log(`  ✗ Duplicate user was created - CONSTRAINT FAILED`);
    } catch (error) {
      if (error.code === 11000) {
        console.log(`  ✓ Duplicate email prevented: ${error.message}`);
      } else {
        throw error;
      }
    }

    // Scenario 3: Find by email (case-insensitive)
    console.log("\n3️⃣  Test: Case-insensitive email lookup");
    const foundUser = await User.findByEmail("TEST-LOCAL@EXAMPLE.COM");
    if (foundUser && foundUser._id.equals(localUser._id)) {
      console.log(`  ✓ Found user by uppercase email`);
    } else {
      console.log(`  ✗ Failed to find user by uppercase email`);
    }

    // Scenario 4: Provider linking
    console.log("\n4️⃣  Test: Provider linking");
    foundUser.linkProvider("google", {
      id: "google-123",
      email: "test-local@example.com",
      picture: "https://example.com/avatar.jpg",
    });
    await foundUser.save();
    console.log(`  ✓ Google provider linked to user`);

    // Scenario 5: Check linked providers
    console.log("\n5️⃣  Test: Check linked providers");
    const providers = foundUser.getLinkedProviders();
    console.log(`  ✓ Linked providers: ${providers.join(", ")}`);
    if (providers.includes("google")) {
      console.log(`  ✓ Google provider is linked`);
    }

    // Scenario 6: Find by provider ID
    console.log("\n6️⃣  Test: Find user by Google ID");
    const userByGoogleId = await User.findByGoogleId("google-123");
    if (userByGoogleId && userByGoogleId._id.equals(localUser._id)) {
      console.log(`  ✓ Found user by Google ID`);
    } else {
      console.log(`  ✗ Failed to find user by Google ID`);
    }

    // Scenario 7: Duplicate provider ID prevention
    console.log("\n7️⃣  Test: Duplicate provider ID prevention");
    try {
      const anotherUser = new User({
        email: "test-google-dup@example.com",
        name: "Another User",
        oauth: {
          google: {
            id: "google-123", // Same as localUser
            email: "test-google-dup@example.com",
          },
          github: {},
        },
      });
      await anotherUser.save();
      console.log(`  ✗ Duplicate Google ID was allowed - CONSTRAINT FAILED`);
    } catch (error) {
      if (error.code === 11000) {
        console.log(`  ✓ Duplicate Google ID prevented: ${error.message}`);
      } else {
        throw error;
      }
    }

    // Clean up
    await User.deleteMany({ email: /^test-/ });
    console.log("\n✓ Test data cleaned up");

  } catch (error) {
    console.error("✗ Test scenario failed:", error.message);
  }
}

async function runVerification() {
  try {
    await connectDB();
    await verifySchema();
    await verifyIndexes();
    await verifyTestScenarios();

    console.log("\n" + "=".repeat(60));
    console.log("✅ Authentication System Upgrade Verification Complete!");
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Verification failed:", error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Run verification
runVerification();
