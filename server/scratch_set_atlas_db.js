const mongoose = require('mongoose');
const path = require('path');
const CryptoJS = require('crypto-js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

const encryptValue = (val) => {
  return CryptoJS.AES.encrypt(val, ENCRYPTION_KEY).toString();
};

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Database successfully.');
    
    const EnvVar = mongoose.model('EnvVar', new mongoose.Schema({}, { strict: false }));
    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));
    
    // Construct the Atlas DB connection string for the user's stockflow database
    const atlasUri = 'mongodb://launchpad:launchpad026@ac-l6nikfa-shard-00-00.1s9kzxe.mongodb.net:27017,ac-l6nikfa-shard-00-01.1s9kzxe.mongodb.net:27017,ac-l6nikfa-shard-00-02.1s9kzxe.mongodb.net:27017/stockflow?ssl=true&replicaSet=atlas-1g5s0m-shard-0&authSource=admin&appName=Cluster0';
    const encryptedValue = encryptValue(atlasUri);
    
    console.log('Updating MONGODB_URI...');
    const result = await EnvVar.updateOne(
      { project: new mongoose.Types.ObjectId('6a2be92715d854b9fc0abdf8'), key: 'MONGODB_URI' },
      { $set: { value: encryptedValue } }
    );
    
    console.log('Update result:', result);
    
    // Also reset the project status to failed, so the user can click redeploy in their browser
    await Project.updateOne(
      { _id: new mongoose.Types.ObjectId('6a2be92715d854b9fc0abdf8') },
      { $set: { status: 'failed' } }
    );
    
    await Deployment.updateMany(
      { project: new mongoose.Types.ObjectId('6a2be92715d854b9fc0abdf8'), status: { $in: ['queued', 'building'] } },
      { $set: { status: 'failed', aiErrorSummary: 'Build reset to apply MONGODB_URI fix' } }
    );
    
    console.log('Stuck records cleared.');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
