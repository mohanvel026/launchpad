const mongoose = require('mongoose');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Database.');
    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    
    const projects = await Project.find({ status: 'failed' });
    console.log(`Found ${projects.length} failed projects to check.`);
    
    for (const p of projects) {
      const containerId = p.get('containerId');
      if (!containerId) {
        console.log(`Project ${p.get('name')} has no containerId.`);
        continue;
      }
      
      let isRunning = false;
      try {
        const inspectOut = execSync(`docker inspect -f "{{.State.Running}}" ${containerId}`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
        isRunning = inspectOut === 'true';
      } catch (e) {
        isRunning = false;
      }
      
      if (isRunning) {
        console.log(`Container for project "${p.get('name')}" is running! Restoring status to "live" and health to 100%.`);
        await Project.findByIdAndUpdate(p._id, { status: 'live', lastHealthScore: 100 });
      } else {
        console.log(`Container for project "${p.get('name')}" is NOT running.`);
      }
    }
    
    console.log('Database restore script complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
