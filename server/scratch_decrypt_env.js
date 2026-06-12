const mongoose = require('mongoose');
const path = require('path');
const CryptoJS = require('crypto-js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

const decryptValue = (encrypted) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, process.env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || encrypted;
  } catch (err) {
    return 'Decryption failed: ' + err.message;
  }
};

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Database successfully.');
    
    const EnvVar = mongoose.model('EnvVar', new mongoose.Schema({}, { strict: false }));
    const vars = await EnvVar.find({ project: new mongoose.Types.ObjectId('6a2be92715d854b9fc0abdf8') });
    
    console.log('=== DECRYPTED ENV VARS ===');
    for (const v of vars) {
      console.log(`Key: ${v.get('key')}`);
      console.log(`Encrypted Value: ${v.get('value')}`);
      console.log(`Decrypted Value: ${decryptValue(v.get('value'))}`);
      console.log('---');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
