const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

const RESUMEIQ_DIR = 'F:/VS/Resume Builder';
const RESUMEIQ_SERVER_ENV = path.join(RESUMEIQ_DIR, 'server/.env');

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to database.');
    
    const Project = require('./src/models/Project.model');
    const Deployment = require('./src/models/Deployment.model');
    const EnvVar = require('./src/models/EnvVar.model');
    const buildQueue = require('./src/workers/build.worker');

    // 1. Create or Find the Project
    let project = await Project.findOne({ subdomain: 'resumeiq' });
    if (!project) {
      console.log('Creating new project entry for resumeiq...');
      project = await Project.create({
        name: 'resumeiq',
        owner: new mongoose.Types.ObjectId('6a15745760c89d386ed0ca34'), // Admin user
        repoFullName: 'mohanvel026/resumeiq',
        repoUrl: RESUMEIQ_DIR,
        branch: 'main',
        stack: 'fullstack-split',
        subdomain: 'resumeiq',
        status: 'idle'
      });
    } else {
      console.log('Project resumeiq already exists. ID:', project._id);
      await Project.findByIdAndUpdate(project._id, {
        repoUrl: RESUMEIQ_DIR,
        stack: 'fullstack-split',
        status: 'idle'
      });
    }
    const projectId = project._id;

    // 2. Parse and upsert environment variables from F:/VS/Resume Builder/server/.env
    if (fs.existsSync(RESUMEIQ_SERVER_ENV)) {
      console.log('Parsing environment variables from Resume Builder server/.env...');
      const envContent = fs.readFileSync(RESUMEIQ_SERVER_ENV, 'utf-8');
      const lines = envContent.split('\n');
      
      // Clear existing env vars for this project to start fresh
      await EnvVar.deleteMany({ project: projectId });

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        
        // Remove surrounding quotes if any
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }

        // Storing PORT in project model config instead or letting it dynamic
        if (key === 'PORT') continue; 

        // Encrypt value using AES
        const encryptedValue = CryptoJS.AES.encrypt(val, ENCRYPTION_KEY).toString();
        
        await EnvVar.create({
          project: projectId,
          key,
          value: encryptedValue,
          isSecret: true
        });
        console.log(`- Saved encrypted env var: ${key}`);
      }
    } else {
      console.warn('Warning: Resume Builder server/.env not found!');
    }

    // 3. Clear any active deployments in building/queued state
    await Deployment.updateMany(
      { project: projectId, status: { $in: ['queued', 'building'] } }, 
      { status: 'failed', finishedAt: new Date(), error: 'Aborted for fresh deployment run' }
    );

    // 4. Compute hashes of env vars and settings
    const dbEnvVars = await EnvVar.find({ project: projectId }).sort({ key: 1 });
    const envStr = dbEnvVars.map(ev => `${ev.key}=${ev.value}`).join('\n');
    const envVarsHash = crypto.createHash('md5').update(envStr).digest('hex');

    const settingsStr = `${project.installCommand || ''}|${project.buildCommand || ''}|${project.outputDir || ''}|${project.branch || ''}|${project.cpuLimit || ''}|${project.ramLimitMB || ''}`;
    const settingsHash = crypto.createHash('md5').update(settingsStr).digest('hex');

    // 5. Create Deployment record
    const deployment = await Deployment.create({
      project:       projectId,
      commitSha:     'manual-setup',
      commitMessage: 'Automated launchpad deploy of ResumeIQ',
      branch:        project.branch,
      status:        'queued',
      envVarsHash,
      settingsHash,
    });

    console.log('Created deployment record ID:', deployment._id);

    // Set project status to building
    await Project.findByIdAndUpdate(projectId, { status: 'building' });

    // 6. Add to Bull build worker queue
    await buildQueue.add(
      { 
        deploymentId: deployment._id.toString(), 
        projectId: projectId.toString(),
        forceRebuild: true
      },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50
      }
    );

    console.log('Successfully added deploy job to Bull MQ buildQueue!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error during deployment setup:', err);
    process.exit(1);
  });
