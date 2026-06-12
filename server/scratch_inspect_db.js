const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('DB Connected.');
    const db = mongoose.connection.db;
    
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    for (const col of collections) {
      const docs = await db.collection(col.name).find({}).toArray();
      console.log(`\n=== Collection: ${col.name} (Count: ${docs.length}) ===`);
      if (docs.length > 0) {
        console.log(JSON.stringify(docs.map(d => {
          // omit large logs/secrets
          const copy = { ...d };
          if (copy.logs) copy.logs = `[Log lines: ${copy.logs.length}]`;
          if (copy.githubAccessToken) copy.githubAccessToken = '***';
          if (copy.password) copy.password = '***';
          return copy;
        }), null, 2));
      }
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
