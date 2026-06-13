const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));
  const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
  const p = await Project.findOne({ subdomain: 'resumeiq' });
  if (!p) {
    console.log('Project resumeiq not found');
    process.exit(1);
  }
  const deployments = await Deployment.find({ project: p._id }).sort({ createdAt: -1 });
  console.log(`Found ${deployments.length} deployments for resumeiq`);
  deployments.forEach((d, idx) => {
    console.log(`\nDeployment #${idx + 1}:`);
    console.log(`  ID:`, d._id);
    console.log(`  Status:`, d.get('status'));
    console.log(`  CreatedAt:`, d.get('createdAt'));
    console.log(`  Logs length:`, (d.get('logs') || []).length);
    if ((d.get('logs') || []).length > 0) {
      console.log(`  Last 100 logs:`);
      (d.get('logs') || []).slice(-100).forEach(l => console.log(`    ${l}`));
    }
  });
  process.exit(0);
});
