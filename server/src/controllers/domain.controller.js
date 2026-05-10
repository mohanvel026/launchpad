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
    const dnsId = await addCustomDomain(customDomain, project.subdomain);

    await Project.findByIdAndUpdate(project._id, { customDomain });

    res.json({
      message: 'Custom domain registered. Point your domain CNAME to your subdomain, then verify.',
      customDomain,
      cname:   `${project.subdomain}.${process.env.CLOUDFLARE_DOMAIN}`,
      dnsId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/domains/:projectId/ssl
// Provisions a Let's Encrypt cert for the project subdomain
const provisionSSLForProject = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found' });
    if (project.status !== 'live') return res.status(400).json({ message: 'Project must be live to provision SSL' });

    // Run certbot (takes 5-15 seconds) — do it synchronously here so the client gets the result
    const success = provisionSSL(project.subdomain);

    if (success) {
      // Rewrite the nginx config with HTTPS blocks
      upgradeToHTTPS(project.subdomain, project.port);
      res.json({ message: `SSL certificate provisioned for ${project.subdomain}.${process.env.CLOUDFLARE_DOMAIN}` });
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

module.exports = { addCustomDomainToProject, provisionSSLForProject, getDomainInfo };