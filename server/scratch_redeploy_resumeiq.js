const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to database.');
    const Project = require('./src/models/Project.model');
    const Deployment = require('./src/models/Deployment.model');
    const EnvVar = require('./src/models/EnvVar.model');
    const buildQueue = require('./src/workers/build.worker');

    const project = await Project.findOne({ subdomain: 'resumeiq' });
    if (!project) {
      console.error('Project not found');
      process.exit(1);
    }
    const projectId = project._id;
    project.repoUrl = 'https://github.com/mohanvel026/resumeiq.git';
    await project.save();
    console.log('Updated repoUrl to: ' + project.repoUrl);

    // Clear any stuck build statuses first
    await Project.findByIdAndUpdate(projectId, { status: 'idle' });
    await Deployment.updateMany(
      { project: projectId, status: { $in: ['queued', 'building'] } }, 
      { status: 'failed', finishedAt: new Date(), error: 'Aborted due to system update' }
    );

    const envVars = await EnvVar.find({ project: projectId }).sort({ key: 1 });
    const envStr = envVars.map(ev => `${ev.key}=${ev.value}`).join('\n');
    const envVarsHash = crypto.createHash('md5').update(envStr).digest('hex');

    const settingsStr = `${project.installCommand || ''}|${project.buildCommand || ''}|${project.outputDir || ''}|${project.branch || ''}|${project.cpuLimit || ''}|${project.ramLimitMB || ''}`;
    const settingsHash = crypto.createHash('md5').update(settingsStr).digest('hex');

    const deployment = await Deployment.create({
      project:       projectId,
      commitSha:     'manual-fix',
      commitMessage: 'Force redeploy after port allocator fix',
      branch:        project.branch,
      status:        'queued',
      envVarsHash,
      settingsHash,
    });

    console.log('Created deployment record:', deployment._id);

    // Reset project status to building
    await Project.findByIdAndUpdate(projectId, { status: 'building' });

    await buildQueue.add(
      { 
        deploymentId: deployment._id.toString(), 
        projectId: projectId,
        forceRebuild: true
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

    console.log('Successfully queued build job in Bull!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
