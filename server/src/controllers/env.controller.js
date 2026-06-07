const CryptoJS = require('crypto-js');
const EnvVar   = require('../models/EnvVar.model');
const Project  = require('../models/Project.model');

const encrypt = (value) =>
  CryptoJS.AES.encrypt(value, process.env.ENCRYPTION_KEY).toString();

const decrypt = (encrypted) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, process.env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch { return ''; }
};

// Check the user owns or collaborates on this project
const verifyAccess = async (projectId, userId) => {
  return Project.findOne({
    _id: projectId,
    $or: [{ owner: userId }, { collaborators: userId }],
  });
};

// GET /api/env/:projectId — return keys only (values masked with ***)
const getEnvVars = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const envVars = await EnvVar.find({ project: project._id }).select('-value');
    res.json({ envVars });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/env/:projectId — upsert an env var (creates or updates by key)
const setEnvVar = async (req, res) => {
  const { key, value, isSecret = true } = req.body;
  if (!key || !value) return res.status(400).json({ message: 'key and value are required' });

  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const encryptedValue = encrypt(value);

    const envVar = await EnvVar.findOneAndUpdate(
      { project: project._id, key },
      { value: encryptedValue, isSecret },
      { upsert: true, returnDocument: 'after' }
    );

    // Return without the encrypted value
    res.json({ envVar: { _id: envVar._id, key: envVar.key, isSecret: envVar.isSecret } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/env/:projectId/:key
const deleteEnvVar = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    await EnvVar.findOneAndDelete({ project: project._id, key: req.params.key });
    res.json({ message: 'Env var deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/env/:projectId/rotate — rotate AES keys for all project variables
const rotateProjectEnvKeys = async (req, res) => {
  const { oldKey, newKey } = req.body;
  if (!oldKey || !newKey) {
    return res.status(400).json({ message: 'oldKey and newKey are required' });
  }

  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      owner: req.user._id // Only owner can rotate keys
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const envVars = await EnvVar.find({ project: project._id });
    let rotatedCount = 0;

    for (const envVar of envVars) {
      try {
        // Decrypt with old key
        const bytes = CryptoJS.AES.decrypt(envVar.value, oldKey);
        const decryptedValue = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedValue) continue; // Skip if decryption fails (e.g. wrong old key)

        // Encrypt with new key
        const encryptedValue = CryptoJS.AES.encrypt(decryptedValue, newKey).toString();
        envVar.value = encryptedValue;
        await envVar.save();
        rotatedCount++;
      } catch (err) {
        console.warn(`Failed to rotate env var "${envVar.key}":`, err.message);
      }
    }

    res.json({ message: `Successfully rotated encryption keys for ${rotatedCount} env vars.`, rotatedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getEnvVars, setEnvVar, deleteEnvVar, rotateProjectEnvKeys };