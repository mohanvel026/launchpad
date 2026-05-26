const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const Deployment = require('./src/models/Deployment.model');
    const Project = require('./src/models/Project.model');

    console.log('Querying latest deployments...');
    const deployments = await Deployment.find().sort({ createdAt: -1 }).limit(5);
    for (const d of deployments) {
      console.log(`\nDeployment ID: ${d._id}`);
      console.log(`Project ID: ${d.project}`);
      console.log(`Status: ${d.status}`);
      console.log(`Commit Message: ${d.commitMessage}`);
      console.log(`AI Error Summary: ${d.aiErrorSummary}`);
      console.log(`Logs (last 10 lines):`);
      if (d.logs && d.logs.length) {
        console.log(d.logs.slice(-10).join('\n'));
      } else {
        console.log('No logs');
      }
    }

    const projects = await Project.find().limit(5);
    console.log(`\nQuerying projects...`);
    for (const p of projects) {
      console.log(`Project: ${p.name}, Subdomain: ${p.subdomain}, Status: ${p.status}`);
    }

    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
