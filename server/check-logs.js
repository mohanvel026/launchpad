require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./src/lib/db');
const Deployment = require('./src/models/Deployment.model');

const deploymentId = process.argv[2] || '6a23b347725b65b7fecd0f1a';

async function main() {
  await connectDB();
  const deployment = await Deployment.findById(deploymentId);
  if (!deployment) {
    console.error('Deployment not found');
    process.exit(1);
  }
  console.log(`Status: ${deployment.status}`);
  console.log('--- Logs ---');
  deployment.logs.forEach(line => console.log(line));
  console.log('------------');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
