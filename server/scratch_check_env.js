const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    const EnvVar = mongoose.model('EnvVar', new mongoose.Schema({}, { strict: false }));
    const vars = await EnvVar.find({ project: new mongoose.Types.ObjectId("6a2bbeb93f5a06680eefd45d") });
    console.log('=== CURRENT ENV VARIABLE KEYS ===');
    vars.forEach(v => console.log(`- Key: ${v.get('key')}`));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
