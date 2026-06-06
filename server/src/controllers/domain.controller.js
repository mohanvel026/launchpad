const Project = require('../models/Project.model');
const { addCustomDomain } = require('../services/cloudflare.service');
const { updateNginxPort, upgradeToHTTPS } = require('../services/nginx.service');
const { provisionSSL } = require('../services/ssl.service');

// POST /api/domains/:projectId/custom
// Lets the user attach their own domain to a project
const addCustomDomainToProject = async (req, res) => {
  const { customDomain } = req.body;
  if (!customDomain) return res.status(400).json({ message: 'customDomain is required' });

  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.status !== 'live') return res.status(400).json({ message: 'Project must be live before adding a custom domain' });

    // Create a CNAME in Cloudflare pointing customDomain → subdomain.launchpad.dev
    const sanitizedDomain = customDomain.trim().toLowerCase();
    const dnsId = await addCustomDomain(sanitizedDomain, project.subdomain);

    await Project.findByIdAndUpdate(project._id, { customDomain: sanitizedDomain });

    // Rewrite Nginx configuration to support the custom domain immediately
    updateNginxPort(project.subdomain, project.port, sanitizedDomain);

    res.json({
      message: 'Custom domain registered and proxy config updated. Point your domain CNAME to your subdomain, then verify.',
      customDomain,
      cname:   `${project.subdomain}.${process.env.CLOUDFLARE_DOMAIN}`,
      dnsId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/domains/:projectId/ssl
// Provisions a Let's Encrypt cert for the project subdomain and custom domain
const provisionSSLForProject = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.status !== 'live') return res.status(400).json({ message: 'Project must be live to provision SSL' });

    // Run certbot (takes 5-15 seconds) to provision multi-domain SSL for both subdomain and custom domain
    const success = provisionSSL(project.subdomain, project.customDomain);

    if (success) {
      // Rewrite the nginx config with HTTPS blocks and custom domain routing
      upgradeToHTTPS(project.subdomain, project.port, project.customDomain);
      res.json({ message: `SSL certificate provisioned successfully for ${project.subdomain}.${process.env.CLOUDFLARE_DOMAIN}${project.customDomain ? ' and ' + project.customDomain : ''}` });
    } else {
      res.status(500).json({ message: 'SSL provisioning failed — check server logs' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/domains/:projectId
const getDomainInfo = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    }).select('subdomain customDomain status port');
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const domain = process.env.CLOUDFLARE_DOMAIN || 'launchpad.dev';
    res.json({
      subdomain:    project.subdomain,
      subdomainUrl: `https://${project.subdomain}.${domain}`,
      customDomain: project.customDomain || null,
      customUrl:    project.customDomain ? `https://${project.customDomain}` : null,
      status:       project.status,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/domains/:projectId/verify
const verifyCustomDomainDNS = async (req, res) => {
  const dns = require('dns').promises;
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (!project.customDomain) return res.status(400).json({ message: 'No custom domain configured' });

    const domain = process.env.CLOUDFLARE_DOMAIN || 'launchpad.dev';
    const targetCname = `${project.subdomain}.${domain}`;

    let verified = false;
    let resolvedTo = 'Unresolved';

    try {
      const addresses = await dns.resolveCname(project.customDomain);
      if (addresses && addresses.length > 0) {
        resolvedTo = addresses[0];
        if (resolvedTo.toLowerCase().includes(targetCname.toLowerCase())) {
          verified = true;
        }
      }
    } catch {
      try {
        const addresses = await dns.resolve4(project.customDomain);
        if (addresses && addresses.length > 0) {
          resolvedTo = addresses.join(', ');
          const serverIp = process.env.SERVER_IP;
          if (serverIp && addresses.includes(serverIp)) {
            verified = true;
          }
        }
      } catch (dnsErr) {
        resolvedTo = `Resolution failed: ${dnsErr.message}`;
      }
    }

    res.json({ verified, resolvedTo, targetCname });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/domains/:projectId/custom
const removeCustomDomainFromProject = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    await Project.findByIdAndUpdate(project._id, { $unset: { customDomain: 1 } });

    // Clean up Nginx routing (reverts back to only default subdomain routing)
    updateNginxPort(project.subdomain, project.port, null);

    res.json({ message: 'Custom domain removed successfully and proxy routing cleared.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  addCustomDomainToProject,
  provisionSSLForProject,
  getDomainInfo,
  verifyCustomDomainDNS,
  removeCustomDomainFromProject
};