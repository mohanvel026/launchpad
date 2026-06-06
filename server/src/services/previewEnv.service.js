const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');

const REPOS_DIR = path.join(__dirname, '../../repos');
const DOMAIN = (process.env.CLOUDFLARE_DOMAIN || 'launchlive.in').toLowerCase();

/**
 * Creates a PR preview environment:
 * - Clones/updates the PR branch locally into a pr-specific dir
 * - Builds and runs a Docker container on a free port
 * - Creates an Nginx config for pr-{N}-{subdomain}.domain
 * Returns: { previewUrl, containerId, port, subdomain }
 */
async function createPreviewEnvironment(project, prNumber, prBranch, repoCloneUrl) {
  const { getNextFreePort } = require('./portAllocator.service');
  const { createNginxConfig } = require('./nginx.service');

  const previewSubdomain = `pr-${prNumber}-${project.subdomain}`;
  const previewRepoDir = path.join(REPOS_DIR, `${project._id}-pr-${prNumber}`);

  // ── Step 1: Clone / update the PR branch ──
  if (fs.existsSync(previewRepoDir)) {
    try {
      execSync(`git -C "${previewRepoDir}" fetch origin "${prBranch}"`, { stdio: 'pipe', timeout: 30000 });
      execSync(`git -C "${previewRepoDir}" checkout "${prBranch}"`, { stdio: 'pipe', timeout: 10000 });
      execSync(`git -C "${previewRepoDir}" reset --hard "origin/${prBranch}"`, { stdio: 'pipe', timeout: 10000 });
    } catch (e) {
      fs.rmSync(previewRepoDir, { recursive: true, force: true });
      execSync(`git clone --branch "${prBranch}" --depth 1 "${repoCloneUrl}" "${previewRepoDir}"`, { stdio: 'pipe', timeout: 60000 });
    }
  } else {
    execSync(`git clone --branch "${prBranch}" --depth 1 "${repoCloneUrl}" "${previewRepoDir}"`, { stdio: 'pipe', timeout: 60000 });
  }

  // ── Step 2: Detect Dockerfile or generate one ──
  const { generateDockerfile } = require('./dockerfile.service');
  const { detectStack } = require('./stackDetector.service');

  const stack = detectStack(previewRepoDir) || project.stack || 'node';
  const dockerfilePath = path.join(previewRepoDir, 'Dockerfile');

  if (!fs.existsSync(dockerfilePath)) {
    const dockerfile = generateDockerfile(stack, {});
    fs.writeFileSync(dockerfilePath, dockerfile);
  }

  // ── Step 3: Build Docker image ──
  const imageTag = `lp-preview-${project._id}-pr-${prNumber}:latest`;
  const containerName = `lp-preview-${project._id}-pr-${prNumber}`;

  execSync(`docker build -t "${imageTag}" "${previewRepoDir}"`, { stdio: 'pipe', timeout: 300000 });

  // ── Step 4: Stop old preview container if exists ──
  try { execSync(`docker rm -f "${containerName}"`, { stdio: 'pipe' }); } catch {}

  // ── Step 5: Run container on free port ──
  const hostPort = await getNextFreePort(5000);
  execSync(`docker run -d --name "${containerName}" -p ${hostPort}:3000 --restart unless-stopped "${imageTag}"`, { stdio: 'pipe', timeout: 30000 });

  // ── Step 6: Create Nginx config for preview subdomain ──
  createNginxConfig(previewSubdomain, hostPort, false, null);

  const previewUrl = `http://${previewSubdomain}.${DOMAIN}`;
  return { previewUrl, containerId: containerName, port: hostPort, subdomain: previewSubdomain };
}

/**
 * Destroys a PR preview environment:
 * - Stops and removes the Docker container
 * - Removes the Nginx config
 * - Deletes the cloned repo directory
 */
async function destroyPreviewEnvironment(project, prNumber) {
  const { removeNginxConfig } = require('./nginx.service');

  const containerName = `lp-preview-${project._id}-pr-${prNumber}`;
  const previewRepoDir = path.join(REPOS_DIR, `${project._id}-pr-${prNumber}`);
  const previewSubdomain = `pr-${prNumber}-${project.subdomain}`;

  // Stop container
  try { execSync(`docker rm -f "${containerName}"`, { stdio: 'pipe', timeout: 15000 }); } catch {}

  // Remove image
  try { execSync(`docker rmi -f "lp-preview-${project._id}-pr-${prNumber}:latest"`, { stdio: 'pipe' }); } catch {}

  // Remove nginx config
  try { removeNginxConfig(previewSubdomain); } catch {}

  // Remove cloned directory
  try { fs.rmSync(previewRepoDir, { recursive: true, force: true }); } catch {}

  return { destroyed: true, prNumber };
}

/**
 * Get status of a specific preview container.
 * Returns: { running: bool, uptime: string }
 */
function getPreviewStatus(project, prNumber) {
  const containerName = `lp-preview-${project._id}-pr-${prNumber}`;
  try {
    const raw = execSync(`docker inspect --format '{{.State.Status}}|||{{.State.StartedAt}}' "${containerName}"`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
    const [status, startedAt] = raw.split('|||');
    return { running: status === 'running', status, startedAt };
  } catch {
    return { running: false, status: 'not found', startedAt: null };
  }
}

module.exports = { createPreviewEnvironment, destroyPreviewEnvironment, getPreviewStatus };
