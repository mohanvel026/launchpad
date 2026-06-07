const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const project = await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId('6a2146ff05572792a1f4e268') });
  console.log(JSON.stringify(project, null, 2));
  
  if (project) {
    // Suspend it automatically
    await db.collection('projects').updateOne(
      { _id: new mongoose.Types.ObjectId('6a2146ff05572792a1f4e268') },
      { $set: { status: 'suspended', suspendedReason: 'Flagged by Microsoft SmartScreen for Phishing' } }
    );
    console.log('\n--> Automatically suspended the malicious project.');
  } else {
    console.log('\n--> Project not found.');
  }
  process.exit(0);
}).catch(console.error);
