const mongoose = require('mongoose');
require('dotenv').config({ path: 'server/.env' });

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const Project = require('./server/src/models/Project.model');
    console.log('Fetching projects...');
    const projects = await Project.find({}, 'name subdomain customDomain customDomainStatus sslStatus status port');
    console.log(JSON.stringify(projects, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
