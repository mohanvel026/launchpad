const fs = require('fs');
const path = require('path');
const { scanRepository } = require('./services/envScanner.service');

const SANDBOX_DIR = path.join(__dirname, '../repos/test-env-scanner-sandbox');

// Helper to set up sandbox files
function setupSandbox() {
  if (fs.existsSync(SANDBOX_DIR)) {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });

  // 1. Nested Node SQL project (Monorepo setup)
  const subProjDir = path.join(SANDBOX_DIR, 'backend');
  fs.mkdirSync(subProjDir, { recursive: true });

  // package.json with SQL dependencies only
  fs.writeFileSync(path.join(subProjDir, 'package.json'), JSON.stringify({
    name: 'sql-backend',
    dependencies: {
      'pg': '^8.11.0',
      'sequelize': '^6.32.0'
    }
  }, null, 2));

  // .env.example with both SQL and MongoDB placeholders (simulating typical template pollution)
  fs.writeFileSync(path.join(subProjDir, '.env.example'), `
# SQL Connection URL
DATABASE_URL=postgres://localhost:5432/mydb

# Falsely present MongoDB URL template (should be filtered out!)
MONGODB_URI=mongodb://localhost:27017/myotherdb
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db

# Authentication secrets
JWT_SECRET=placeholder_value
JWT_TOKEN=another_token_placeholder
`);

  // Source code file referencing env vars
  fs.writeFileSync(path.join(subProjDir, 'app.js'), `
const express = require('express');
const dbUrl = process.env.DATABASE_URL;
const secret = process.env.JWT_SECRET;
const token = process.env.JWT_TOKEN;
console.log("App running with db " + dbUrl);
`);

  // 2. Separate file with leaked keys
  const googleSecretStr = "AIzaSy" + "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
  const awsSecretStr = "AKIA" + "1234567890123456";
  const stripeSecretStr = "sk_test_" + "123456789012345678901234";

  fs.writeFileSync(path.join(SANDBOX_DIR, 'credentials.js'), `
// Exposed secrets in codebase
const googleApiKey = "${googleSecretStr}";
const awsAccessKey = "${awsSecretStr}";
const stripeKey = "${stripeSecretStr}";
`);
}

function teardownSandbox() {
  if (fs.existsSync(SANDBOX_DIR)) {
    fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING AI ENVIRONMENT AUTO-DETECTION TEST SUITE");
  console.log("==================================================");

  try {
    setupSandbox();
    console.log("✔ Sandbox environment set up at:", SANDBOX_DIR);

    console.log("\nScanning sandbox directory...");
    const results = scanRepository(SANDBOX_DIR, 'node');

    console.log("\n================ SCAN RESULTS ================");
    console.log("Candidate Keys Found:", results.candidateKeys);
    console.log("Parsed Dependencies:", results.dependenciesList);
    console.log("Security Warnings:", JSON.stringify(results.securityWarnings, null, 2));
    console.log("Collisions Detected:", JSON.stringify(results.collisions, null, 2));
    console.log("==============================================");

    // Assertions
    let passed = true;

    // A. Check that DATABASE_URL is present
    if (!results.candidateKeys.includes('DATABASE_URL')) {
      console.error("❌ Test Failed: DATABASE_URL should be detected.");
      passed = false;
    } else {
      console.log("✔ Test Passed: DATABASE_URL correctly detected.");
    }

    // B. Check that MONGODB_URI/MONGO_URI are filtered out
    if (results.candidateKeys.includes('MONGODB_URI') || results.candidateKeys.includes('MONGO_URI')) {
      console.error("❌ Test Failed: MongoDB keys should be filtered out as no MongoDB dependencies exist.");
      passed = false;
    } else {
      console.log("✔ Test Passed: MongoDB keys successfully filtered out.");
    }

    // C. Check that JWT redundancy collision is detected
    const hasJwtCollision = results.collisions.some(c => c.type === 'JWT Secret Redundancy');
    if (!hasJwtCollision) {
      console.error("❌ Test Failed: JWT Secret Redundancy collision should be detected.");
      passed = false;
    } else {
      console.log("✔ Test Passed: JWT Secret Redundancy collision correctly identified.");
    }

    // D. Check for leaked credentials warnings
    const leakedTypes = results.securityWarnings.map(w => w.type);
    if (!leakedTypes.includes('Google API Key') || !leakedTypes.includes('AWS Access Key ID') || !leakedTypes.includes('Stripe Secret Key')) {
      console.error("❌ Test Failed: Leaked Google, AWS, and Stripe credentials should be detected.");
      passed = false;
    } else {
      console.log("✔ Test Passed: All hardcoded credentials successfully audited.");
    }

    if (passed) {
      console.log("\n==============================================");
      console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉");
      console.log("==============================================");
    } else {
      console.log("\n==============================================");
      console.log("❌ SOME TESTS FAILED. CHECK LOGS ABOVE. ❌");
      console.log("==============================================");
    }

  } catch (err) {
    console.error("System test error:", err);
  } finally {
    teardownSandbox();
    console.log("\n✔ Sandbox cleaned up.");
  }
}

runTests();
