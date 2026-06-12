const mongoose = require('mongoose');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Database.');

    const Project = mongoose.model('Project', new mongoose.Schema({}, { strict: false }));
    const EnvVar = mongoose.model('EnvVar', new mongoose.Schema({}, { strict: false }));
    const Deployment = mongoose.model('Deployment', new mongoose.Schema({}, { strict: false }));

    const projects = await Project.find({});
    console.log(`Found ${projects.length} projects to delete.`);

    for (const project of projects) {
      const projectIdStr = project._id.toString();
      const subdomain = project.get('subdomain');
      const dnsRecordId = project.get('dnsRecordId');
      const name = project.get('name');

      console.log(`\nDeleting project: "${name}" (${projectIdStr})...`);

      // Clean up server resources
      const containerName = `lp-${projectIdStr.slice(-8)}`;
      const repoDir = path.join(__dirname, 'repos', projectIdStr);

      // Stop and remove docker container
      try {
        console.log(`Stopping Docker container: ${containerName}`);
        execSync(`docker rm -f ${containerName} || true`, { stdio: 'inherit' });
      } catch (err) {
        console.error(`Failed to stop container: ${err.message}`);
      }

      // Remove repo files
      try {
        console.log(`Deleting repo folder: ${repoDir}`);
        // Windows fallback if rm -rf fails
        if (process.platform === 'win32') {
          execSync(`rmdir /s /q "${repoDir}" || true`, { stdio: 'inherit' });
        } else {
          execSync(`rm -rf ${repoDir} || true`, { stdio: 'inherit' });
        }
      } catch (err) {
        console.error(`Failed to delete repo files: ${err.message}`);
      }

      // Remove Nginx config
      try {
        console.log(`Removing Nginx config for subdomain: ${subdomain}`);
        const { removeNginxConfig } = require('./src/services/nginx.service');
        removeNginxConfig(subdomain);
      } catch (nginxErr) {
        console.error(`Failed to clean up Nginx config: ${nginxErr.message}`);
      }

      // Remove DNS record
      try {
        if (dnsRecordId) {
          console.log(`Deleting Cloudflare DNS record: ${dnsRecordId}`);
          const { deleteSubdomain } = require('./src/services/cloudflare.service');
          await deleteSubdomain(dnsRecordId);
        }
      } catch (dnsErr) {
        console.error(`Failed to clean up Cloudflare DNS: ${dnsErr.message}`);
      }

      // Revoke SSL
      try {
        console.log(`Revoking SSL for subdomain: ${subdomain}`);
        const { revokeSSL } = require('./src/services/ssl.service');
        revokeSSL(subdomain);
      } catch (sslErr) {
        console.error(`Failed to revoke SSL: ${sslErr.message}`);
      }

      // Delete database records
      console.log(`Removing DB records for envvars, deployments, and the project...`);
      await EnvVar.deleteMany({ project: project._id });
      await Deployment.deleteMany({ project: project._id });
      await Project.deleteOne({ _id: project._id });

      console.log(`Successfully deleted project: "${name}"`);
    }

    console.log('\nAll projects successfully deleted and VPS/server resources cleaned up!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Database connection error:', err);
    process.exit(1);
  });
