const User    = require('../models/User.model');
const Project = require('../models/Project.model');

// GET /api/settings/profile
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/settings/profile
const updateProfile = async (req, res) => {
  const { email, notifyOnDeploy, notifyOnCrash } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { email, notifyOnDeploy, notifyOnCrash },
      { new: true }
    );
    res.json({ user, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/settings/token
// Returns the JWT token for CLI usage
const getToken = async (req, res) => {
  try {
    const jwt   = require('jsonwebtoken');
    const token = jwt.sign(
      { id: req.user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, expiresIn: '30 days' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/settings/stats
// Returns account-wide stats
const getStats = async (req, res) => {
  try {
    const projectCount = await Project.countDocuments({ owner: req.user._id });
    const liveCount    = await Project.countDocuments({ owner: req.user._id, status: 'live' });
    const failedCount  = await Project.countDocuments({ owner: req.user._id, status: 'failed' });

    res.json({
      stats: {
        totalProjects: projectCount,
        liveProjects:  liveCount,
        failedProjects: failedCount,
        appLimit:      req.user.appLimit,
        appsRemaining: req.user.appLimit - projectCount,
        plan:          req.user.plan,
        memberSince:   req.user.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/settings/account
// Delete user account and all their projects
const deleteAccount = async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== req.user.username) {
      return res.status(400).json({ message: 'Type your username to confirm deletion' });
    }

    const { exec } = require('child_process');
    const util = require('util');
    const path = require('path');
    const execPromise = util.promisify(exec);

    // Find all projects owned by this user
    const projects = await Project.find({ owner: req.user._id });

    // Clean up resources for each project
    for (const project of projects) {
      try {
        const containerName = `lp-${project._id.toString().slice(-8)}`;
        const repoDir = path.join(__dirname, '../../repos', project._id.toString());

        // Stop and remove docker container
        await execPromise(`docker rm -f ${containerName} || true`);
        // Remove repo files
        await execPromise(`rm -rf ${repoDir} || true`);

        // Remove Nginx configuration
        try {
          const { removeNginxConfig } = require('../services/nginx.service');
          removeNginxConfig(project.subdomain);
        } catch (nginxErr) {
          console.error('Failed to clean up Nginx config during account delete:', nginxErr.message);
        }

        // Remove DNS record from Cloudflare
        try {
          const { deleteSubdomain } = require('../services/cloudflare.service');
          if (project.dnsRecordId) {
            await deleteSubdomain(project.dnsRecordId);
          }
        } catch (dnsErr) {
          console.error('Failed to clean up Cloudflare DNS during account delete:', dnsErr.message);
        }

        // Revoke SSL certificate
        try {
          const { revokeSSL } = require('../services/ssl.service');
          revokeSSL(project.subdomain);
        } catch (sslErr) {
          console.error('Failed to revoke SSL during account delete:', sslErr.message);
        }

        // Delete associated database records
        const EnvVar = require('../models/EnvVar.model');
        const Deployment = require('../models/Deployment.model');
        await EnvVar.deleteMany({ project: project._id });
        await Deployment.deleteMany({ project: project._id });

      } catch (projectCleanupErr) {
        console.error(`Failed to clean up project ${project.name} during account delete:`, projectCleanupErr);
      }
    }

    // Delete all projects from DB
    await Project.deleteMany({ owner: req.user._id });

    // Delete user
    await User.findByIdAndDelete(req.user._id);

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getProfile, updateProfile, getToken, getStats, deleteAccount };