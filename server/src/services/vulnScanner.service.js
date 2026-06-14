const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { callAI, safeParseJson } = require('./ai.service');

/**
 * Reads package.json from repoPath and queries OSV.dev for CVEs.
 * Returns { packages: [{name, version, vulns:[{id,severity,summary,fixedIn}]}], summary: {critical,high,medium,low} }
 */
async function scanForVulnerabilities(repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  const lockPaths = [
    path.join(repoPath, 'package-lock.json'),
    path.join(repoPath, 'yarn.lock'),
  ];

  if (!fs.existsSync(pkgPath)) return { packages: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, scannedAt: new Date() };

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { return { packages: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, scannedAt: new Date() }; }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const queries = Object.entries(deps)
    .filter(([name, version]) => {
      return typeof version === 'string' && 
             !version.startsWith('git') && 
             !version.startsWith('http') && 
             !version.startsWith('file:') &&
             !version.startsWith('workspace:') &&
             version !== '*' &&
             version !== 'latest';
    })
    .slice(0, 50)
    .map(([name, version]) => ({
      package: { name, ecosystem: 'npm' },
      version: version.replace(/^[\^~>=<]/, '').trim()
    }));

  if (queries.length === 0) return { packages: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, scannedAt: new Date() };

  let osvResults = [];
  try {
    const res = await axios.post('https://api.osv.dev/v1/querybatch', { queries }, { timeout: 15000 });
    osvResults = res.data.results || [];
  } catch (err) {
    console.warn('[VulnScanner] OSV API error:', err.message);
    // Return empty if OSV unreachable
    return { packages: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, scannedAt: new Date(), error: 'OSV API unreachable' };
  }

  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  const packages = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const result = osvResults[i];
    if (!result || !result.vulns || result.vulns.length === 0) continue;

    const vulns = result.vulns.map(v => {
      const severity = normalizeSeverity(v.database_specific?.severity || v.severity?.[0]?.score || '');
      summary[severity] = (summary[severity] || 0) + 1;
      const fixedIn = v.affected?.[0]?.ranges?.[0]?.events?.find(e => e.fixed)?.fixed || null;
      return {
        id: v.id,
        severity,
        summary: v.summary || v.details?.slice(0, 200) || 'No details available.',
        fixedIn,
        url: `https://osv.dev/vulnerability/${v.id}`
      };
    });

    packages.push({ name: query.package.name, version: query.version, vulns });
  }

  return { packages, summary, scannedAt: new Date() };
}

function normalizeSeverity(raw) {
  if (!raw) return 'low';
  const s = String(raw).toUpperCase();
  if (s.includes('CRITICAL') || parseFloat(s) >= 9.0) return 'critical';
  if (s.includes('HIGH') || parseFloat(s) >= 7.0) return 'high';
  if (s.includes('MEDIUM') || parseFloat(s) >= 4.0) return 'medium';
  return 'low';
}

/**
 * Uses AI to generate upgrade patch commands for critical/high CVEs.
 * Returns { patchCommands: string[], description: string }
 */
async function generateVulnFixPatch(vulnerablePackages, repoPath) {
  const pkgPath = path.join(repoPath, 'package.json');
  let pkgContent = '{}';
  try { pkgContent = fs.readFileSync(pkgPath, 'utf8').slice(0, 3000); } catch {}

  const criticalAndHigh = vulnerablePackages.filter(p => p.vulns.some(v => v.severity === 'critical' || v.severity === 'high'));
  if (criticalAndHigh.length === 0) return { patchCommands: [], description: 'No critical/high severity issues found.' };

  const systemPrompt = `You are a security engineer. Given a list of vulnerable npm packages and their fixed versions, generate the exact npm install commands to upgrade them.

Respond ONLY with valid JSON:
{ "patchCommands": ["npm install package@safeVersion", ...], "description": "Brief summary of the security patches." }

Only include packages that have a known fixedIn version. Do not include markdown.`;

  const userPrompt = `Vulnerable packages:\n${JSON.stringify(criticalAndHigh.map(p => ({ name: p.name, currentVersion: p.version, vulns: p.vulns.filter(v => v.fixedIn) })), null, 2)}\n\npackage.json:\n${pkgContent}`;

  try {
    const raw = await callAI(systemPrompt, userPrompt, 600, true);
    if (!raw) return { patchCommands: [], description: 'AI unavailable.' };
    const parsed = safeParseJson(raw);
    return {
      patchCommands: Array.isArray(parsed.patchCommands) ? parsed.patchCommands : [],
      description: parsed.description || 'Security patches generated.'
    };
  } catch (err) {
    console.error('[VulnScanner] AI patch generation error:', err.message);
    // Fallback: generate commands manually from fixedIn versions
    const cmds = criticalAndHigh.flatMap(p =>
      p.vulns.filter(v => v.fixedIn).map(v => `npm install ${p.name}@${v.fixedIn}`)
    );
    return { patchCommands: [...new Set(cmds)], description: 'Auto-generated upgrade commands based on OSV fixed versions.' };
  }
}

module.exports = { scanForVulnerabilities, generateVulnFixPatch };
