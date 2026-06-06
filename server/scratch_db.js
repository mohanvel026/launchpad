const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const adminDb = mongoose.connection.db.admin();
    const dbs = await adminDb.listDatabases();
    console.log('Available databases:', dbs.databases.map(d => d.name));
    
    for (const dbInfo of dbs.databases) {
      const dbName = dbInfo.name;
      if (['admin', 'local', 'config'].includes(dbName)) continue;
      
      const dbConn = mongoose.connection.useDb(dbName);
      // Define Project model for this db connection
      const ProjectSchema = new mongoose.Schema({
        name: String,
        subdomain: String,
        customDomain: String,
        customDomainStatus: String,
        sslStatus: String,
        status: String,
        port: Number
      }, { strict: false });
      
      const Project = dbConn.model('Project', ProjectSchema);
      const projects = await Project.find({});
      if (projects.length > 0) {
        console.log(`\n--- Projects in database: ${dbName} ---`);
        console.log(JSON.stringify(projects, null, 2));
      }
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
