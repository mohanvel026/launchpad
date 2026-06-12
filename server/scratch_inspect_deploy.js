const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));
    const dep = await Deployment.findById("6a2be92815d854b9fc0abdf9");
    if (!dep) {
      console.log('Deployment not found');
    } else {
      console.log('=== FULL DEPLOYMENT LOGS ===');
      const logs = dep.get('logs') || [];
      logs.forEach((l, idx) => console.log(`[${idx}] ${l}`));
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
