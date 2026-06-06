require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./src/lib/db');
const Project = require('./src/models/Project.model');
const Deployment = require('./src/models/Deployment.model');
const buildQueue = require('./src/workers/build.worker');

const projectId = '6a23afa7ba3c8f2e9f012be7';

async function main() {
  await connectDB();
  const project = await Project.findById(projectId);
  if (!project) {
    console.error('Project not found');
    process.exit(1);
  }

  // Prevent concurrent builds
  const running = await Deployment.findOne({ project: project._id, status: { $in: ['queued', 'building'] } });
  if (running) {
    console.log(`A build is already in progress (Deployment ID: ${running._id}).`);
    process.exit(0);
  }

  const deployment = await Deployment.create({
    project:       project._id,
    triggeredBy:   project.owner,
    commitSha:     'manual',
    commitMessage: 'Manual deploy via trigger script',
    branch:        project.branch || 'main',
    status:        'queued',
  });

  await buildQueue.add(
    { deploymentId: deployment._id.toString(), projectId: project._id.toString() },
    { attempts: 1, removeOnComplete: 50, removeOnFail: 50 }
  );

  console.log(`Successfully queued deployment: ${deployment._id}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
