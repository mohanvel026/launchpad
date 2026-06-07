const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Cluster.');
    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));
    
    const projects = await Project.find({});
    console.log(`Found ${projects.length} projects.`);
    
    for (const p of projects) {
      console.log(`\n==================================`);
      console.log(`Project: ${p.get('name')} (${p._id})`);
      console.log(`Status: ${p.get('status')}`);
      console.log(`Framework: ${p.get('framework')}`);
      console.log(`Port: ${p.get('port')}`);
      console.log(`Subdomain: ${p.get('subdomain')}`);
      
      const latestDep = await Deployment.findOne({ project: p._id }).sort({ createdAt: -1 });
      if (latestDep) {
        console.log(`Latest Deployment ID: ${latestDep._id}`);
        console.log(`Latest Deployment Status: ${latestDep.get('status')}`);
        console.log(`Latest Deployment Error: ${latestDep.get('error') || 'none'}`);
        const logs = latestDep.get('logs') || [];
        console.log(`Latest Deployment Last 5 Logs:`);
        logs.slice(-5).forEach(l => console.log(`  ${l}`));
      } else {
        console.log('No deployments found.');
      }
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
