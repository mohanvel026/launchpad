const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Database successfully.');
    
    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));
    
    const projects = await Project.find({});
    console.log('=== ALL PROJECTS ===');
    for (const p of projects) {
      console.log(`- ID: ${p._id}, Name: "${p.get('name')}", Stack: "${p.get('stack')}", Subdomain: "${p.get('subdomain')}", Status: "${p.get('status')}", ContainerID: "${p.get('containerId')}", Port: ${p.get('port')}`);
    }
    
    const deployments = await Deployment.find({}).sort({ createdAt: -1 }).limit(10);
    console.log('\n=== LATEST 10 DEPLOYMENTS ===');
    for (const dep of deployments) {
      const p = await Project.findById(dep.get('project'));
      console.log(`- ID: ${dep._id}, Project: "${p ? p.get('name') : 'Unknown'}", Status: "${dep.get('status')}", CreatedAt: ${dep.get('createdAt')}, CompletedAt: ${dep.get('completedAt')}`);
      const logs = dep.get('logs') || [];
      console.log(`    Logs length: ${logs.length}`);
      if (logs.length > 0) {
        console.log('    Last 5 logs:');
        logs.slice(-5).forEach(l => console.log(`      ${l}`));
      }
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error connecting to database:', err);
    process.exit(1);
  });


