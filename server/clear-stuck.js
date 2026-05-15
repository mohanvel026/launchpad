const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const Deployment = require('./src/models/Deployment.model');
    const Project = require('./src/models/Project.model');
    
    console.log('Finding stuck deployments...');
    const result = await Deployment.updateMany(
      { status: { $in: ['queued', 'building'] } },
      { $set: { status: 'failed', aiErrorSummary: 'Build aborted due to server crash/restart' } }
    );
    console.log(`Cleared ${result.modifiedCount} stuck deployments.`);
    
    await Project.updateMany(
      { status: 'building' },
      { $set: { status: 'failed' } }
    );
    
    console.log('Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
