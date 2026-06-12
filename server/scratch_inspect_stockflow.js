const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to Database successfully.');
    
    const User = require('./src/models/User.model');
    const Project = require('./src/models/Project.model');
    
    const project = await Project.findById('6a2be92715d854b9fc0abdf8').populate('owner', 'githubAccessToken');
    if (!project) {
      console.log('Project not found');
      process.exit(1);
    }
    
    console.log('Project found:', project.name);
    console.log('Repo URL:', project.repoUrl);
    console.log('Branch:', project.branch);
    
    let cloneUrl = project.repoUrl;
    if (project.owner && project.owner.githubAccessToken) {
      console.log('GitHub access token found!');
      cloneUrl = cloneUrl.replace('https://', `https://${project.owner.githubAccessToken}@`);
    } else {
      console.log('No GitHub access token found.');
    }
    
    const targetDir = path.join(__dirname, 'repos', 'stockflow_temp');
    if (fs.existsSync(targetDir)) {
      console.log('Cleaning up existing temp directory...');
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    
    console.log('Cloning repository...');
    try {
      execSync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${targetDir}"`, { stdio: 'inherit' });
      console.log('Repository cloned successfully.');
      
      console.log('\n=== FILE LISTING ===');
      const files = fs.readdirSync(targetDir);
      files.forEach(f => {
        const stats = fs.statSync(path.join(targetDir, f));
        console.log(`- ${f} ${stats.isDirectory() ? '(dir)' : '(file)'}`);
      });
      
      const packageJsonPath = path.join(targetDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        console.log('\n=== package.json ===');
        console.log(fs.readFileSync(packageJsonPath, 'utf8'));
      }
      
      const backendPackageJson = path.join(targetDir, 'backend', 'package.json');
      if (fs.existsSync(backendPackageJson)) {
        console.log('\n=== backend/package.json ===');
        console.log(fs.readFileSync(backendPackageJson, 'utf8'));
      }
      
      const frontendPackageJson = path.join(targetDir, 'frontend', 'package.json');
      if (fs.existsSync(frontendPackageJson)) {
        console.log('\n=== frontend/package.json ===');
        console.log(fs.readFileSync(frontendPackageJson, 'utf8'));
      }
      
    } catch (err) {
      console.error('Git clone or inspection failed:', err.message);
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
