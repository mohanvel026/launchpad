const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;
const DEPLOYMENT_ID = '6a2bef238bfc51cc5201423a';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to database. Watching deployment logs...');
    
    const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));
    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    
    let lastLogIndex = 0;
    
    const checkLogs = async () => {
      const dep = await Deployment.findById(DEPLOYMENT_ID);
      if (!dep) {
        console.log('Deployment not found.');
        process.exit(1);
      }
      
      const logs = dep.get('logs') || [];
      if (logs.length > lastLogIndex) {
        for (let i = lastLogIndex; i < logs.length; i++) {
          console.log(logs[i]);
        }
        lastLogIndex = logs.length;
      }
      
      const status = dep.get('status');
      console.log(`[Status: ${status}]`);
      
      if (status !== 'queued' && status !== 'building') {
        console.log(`\nDeployment finished with status: ${status}`);
        if (status === 'failed') {
          console.log('AI Error Summary:', dep.get('aiErrorSummary'));
        } else {
          const project = await Project.findById(dep.get('project'));
          console.log(`Project is live at: https://${project.get('subdomain')}.launchlive.in`);
        }
        process.exit(0);
      }
    };
    
    await checkLogs();
    const timer = setInterval(checkLogs, 5000);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
