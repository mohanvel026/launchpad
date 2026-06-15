const CryptoJS      = require('crypto-js');
const EnvVar        = require('../models/EnvVar.model');
const Project       = require('../models/Project.model');
const EnvVarHistory = require('../models/EnvVarHistory.model');

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

// GET /api/env/:projectId — return keys only (values masked with ***, plus placeholder check)
const getEnvVars = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const envVars = await EnvVar.find({ project: project._id });
    const formatted = envVars.map(e => {
      let hasPlaceholder = false;
      try {
        const val = decrypt(e.value) || '';
        hasPlaceholder = val.includes('placeholder') || val.includes('your_') || val.includes('${') || val.includes('{{') || val.trim() === '';
      } catch (err) {}
      
      return {
        _id: e._id,
        key: e.key,
        isSecret: e.isSecret,
        scopes: e.scopes || ['production', 'preview', 'development'],
        hasPlaceholder
      };
    });

    res.json({ envVars: formatted });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/env/:projectId — upsert an env var (creates or updates by key)
const setEnvVar = async (req, res) => {
  const { key, value, isSecret = true, scopes } = req.body;
  if (!key || !value) return res.status(400).json({ message: 'key and value are required' });

  const upperKey = key.trim().toUpperCase();
  const trimmedValue = value.trim();

  // SRE Connection URL Validation (Allowing placeholder patterns containing ${...} or {{...}})
  const hasPlaceholder = trimmedValue.includes('${') || trimmedValue.includes('{{');
  if (!hasPlaceholder) {
    if (upperKey === 'MONGODB_URI' || upperKey === 'MONGO_URI') {
      if (!/^(mongodb(?:\+srv)?):\/\/.+$/i.test(trimmedValue)) {
        return res.status(400).json({ message: 'Invalid MongoDB connection string format. Must start with mongodb:// or mongodb+srv://' });
      }
    } else if (upperKey === 'REDIS_URL' || upperKey === 'REDIS_URI') {
      if (!/^(rediss?):\/\/.+$/i.test(trimmedValue)) {
        return res.status(400).json({ message: 'Invalid Redis connection string format. Must start with redis:// or rediss://' });
      }
    } else if (upperKey === 'DATABASE_URL' || upperKey === 'DATABASE_URI' || upperKey === 'POSTGRES_URL') {
      if (!/^(postgres|postgresql|mysql|mariadb|sqlite|mongodb(?:\+srv)?):\/\/.+$/i.test(trimmedValue)) {
        return res.status(400).json({ message: 'Invalid Database connection URL format. Must start with a valid database scheme (e.g. postgres://, mysql://, sqlite://)' });
      }
    } else if (upperKey.endsWith('_URL') || upperKey.endsWith('_URI')) {
      if (!/^(https?|wss?):\/\/.+$/i.test(trimmedValue)) {
        return res.status(400).json({ message: `Invalid URL format for ${key}. Must start with http://, https://, ws://, or wss://` });
      }
    }
  }

  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const existing = await EnvVar.findOne({ project: project._id, key });
    const action = existing ? 'update' : 'create';

    const encryptedValue = encrypt(value);

    const envVar = await EnvVar.findOneAndUpdate(
      { project: project._id, key },
      { 
        value: encryptedValue, 
        isSecret,
        scopes: scopes || ['production', 'preview', 'development']
      },
      { upsert: true, returnDocument: 'after' }
    );

    // Track in History Audit Log
    await EnvVarHistory.create({
      project: project._id,
      key,
      value: encryptedValue,
      scopes: scopes || ['production', 'preview', 'development'],
      action,
      user: req.user._id
    });

    // Return without the encrypted value
    res.json({ envVar: { _id: envVar._id, key: envVar.key, isSecret: envVar.isSecret, scopes: envVar.scopes } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/env/:projectId/:key
const deleteEnvVar = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const existing = await EnvVar.findOne({ project: project._id, key: req.params.key });
    if (existing) {
      // Track deletion in history
      await EnvVarHistory.create({
        project: project._id,
        key: req.params.key,
        value: null,
        scopes: existing.scopes,
        action: 'delete',
        user: req.user._id
      });
      await EnvVar.findOneAndDelete({ project: project._id, key: req.params.key });
    }
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

// GET /api/env/:projectId/history — return audit log of env var revisions
const getEnvHistory = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const history = await EnvVarHistory.find({ project: project._id })
      .populate('user', 'name email')
      .sort({ timestamp: -1 })
      .limit(50);

    res.json({ history });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/env/:projectId/:key/reveal — decrypt and reveal a single env var value
const revealEnvVar = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const envVar = await EnvVar.findOne({ project: project._id, key: req.params.key });
    if (!envVar) return res.status(404).json({ message: 'Environment variable not found' });

    const decryptedValue = decrypt(envVar.value);
    res.json({ key: envVar.key, value: decryptedValue });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/env/:projectId/history/:historyId/restore — restore an env var to a previous value
const restoreEnvHistory = async (req, res) => {
  try {
    const project = await verifyAccess(req.params.projectId, req.user._id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const entry = await EnvVarHistory.findOne({ _id: req.params.historyId, project: project._id });
    if (!entry) return res.status(404).json({ message: 'History entry not found' });

    if (entry.action === 'delete') {
      await EnvVar.findOneAndDelete({ project: project._id, key: entry.key });
      await EnvVarHistory.create({
        project: project._id,
        key: entry.key,
        value: null,
        scopes: entry.scopes,
        action: 'delete',
        user: req.user._id
      });
    } else {
      await EnvVar.findOneAndUpdate(
        { project: project._id, key: entry.key },
        {
          value: entry.value,
          scopes: entry.scopes,
          isSecret: true
        },
        { upsert: true }
      );
      await EnvVarHistory.create({
        project: project._id,
        key: entry.key,
        value: entry.value,
        scopes: entry.scopes,
        action: 'restore',
        user: req.user._id
      });
    }

    res.json({ message: `Successfully restored variable "${entry.key}" to historical state.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getEnvVars,
  setEnvVar,
  deleteEnvVar,
  rotateProjectEnvKeys,
  revealEnvVar,
  getEnvHistory,
  restoreEnvHistory
};