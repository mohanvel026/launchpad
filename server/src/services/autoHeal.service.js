const fs = require('fs');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(require('child_process').exec);
const { callAI, safeParseJson, compressLogs } = require('./ai.service');

// Helper to list all code files in the repository recursively
function listFiles(dir, baseDir = dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/');

    // Skip heavy or irrelevant directories
    if (['node_modules', '.git', 'dist', '.next', 'build', 'out', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(file)) {
      continue;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      listFiles(filePath, baseDir, fileList);
    } else {
      // Focus on code/config files to avoid context bloat
      if (/\.(js|jsx|ts|tsx|json|html|css|yml|yaml|conf|config)$/i.test(file)) {
        fileList.push(relPath);
      }
    }
  }
  return fileList;
}

// Inspect logs to suggest which files are relevant to the crash
function findRelevantFilesFromLogs(logs, filesInRepo) {
  const relevant = new Set();
  for (const relPath of filesInRepo) {
    const fileName = path.basename(relPath);
    // If log contains filename (e.g. App.jsx) or relative path, it's relevant
    if (logs.includes(fileName) || logs.includes(relPath)) {
      relevant.add(relPath);
    }
  }
  // Always include key configs if present
  ['package.json', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'nuxt.config.js', 'tailwind.config.js'].forEach(f => {
    if (filesInRepo.includes(f)) relevant.add(f);
  });
  return Array.from(relevant);
}

// Normalize CRLF to LF for consistent matching
function normalizeNewlines(str) {
  return str.replace(/\r\n/g, '\n').trim();
}

// Resilient line-by-line loose replacement (ignores spaces, indentation, and empty line mismatches)
function looseReplace(fileContent, originalText, replacementText) {
  const fileLines = fileContent.split('\n');
  const originalLines = originalText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (originalLines.length === 0) return null;

  for (let i = 0; i <= fileLines.length - originalLines.length; i++) {
    let match = true;
    let fileIdx = i;
    let origIdx = 0;

    while (origIdx < originalLines.length && fileIdx < fileLines.length) {
      const fileLineTrimmed = fileLines[fileIdx].trim();
      if (fileLineTrimmed.length === 0) {
        fileIdx++;
        continue;
      }

      if (fileLineTrimmed !== originalLines[origIdx]) {
        match = false;
        break;
      }

      fileIdx++;
      origIdx++;
    }

    if (match && origIdx === originalLines.length) {
      const before = fileLines.slice(0, i);
      const after = fileLines.slice(fileIdx);
      return [...before, replacementText, ...after].join('\n');
    }
  }
  return null;
}

/**
 * Generate code patches using Gemini/Groq
 */
async function generateFixPatch(repoPath, logs, stack) {
  try {
    const filesInRepo = listFiles(repoPath);
    const relevantFiles = findRelevantFilesFromLogs(logs, filesInRepo);

    const filesContent = {};
    for (const relPath of relevantFiles) {
      try {
        const fullPath = path.join(repoPath, relPath);
        // Limit to first 12KB of content per file to prevent hitting context limits
        const content = fs.readFileSync(fullPath, 'utf8').slice(0, 12000);
        filesContent[relPath] = content;
      } catch {}
    }

    const systemPrompt = `You are LaunchLive Auto-Healer, an expert SRE and DevOps AI.
Your job is to generate a precise code patch to resolve build, dependency, packaging, config, or runtime startup errors.

You must respond ONLY with a valid JSON object matching this schema:
{
  "patches": [
    {
      "filePath": "src/App.jsx",
      "originalContent": "exact original block of lines to replace",
      "replacementContent": "exact new block of lines to write"
    }
  ],
  "description": "Explanation of the auto-healing fix applied."
}

Rules:
1. In "originalContent", specify the EXACT block of lines of code to modify. It MUST match the target file content character-for-character, including whitespace and indentation.
2. In "replacementContent", provide the modified replacement code.
3. If you need to create a new file, set "originalContent" to an empty string "".
4. If you don't know how to fix the error, return an empty array for "patches".
5. If the error is a missing dependency or unresolved import (e.g. "failed to resolve import 'X'", "Cannot find module 'X'", "Can't resolve 'X'", etc.), you MUST patch `package.json` to add the missing package 'X' to the "dependencies" object (use a suitable stable version or "latest").
6. Respond with ONLY the raw JSON object. Do not wrap it in markdown blocks or backticks.`;

    const compressedLogs = compressLogs(logs, 4000);
    const userPrompt = `Stack: ${stack}
Files in repository:
${filesInRepo.map(f => `- ${f}`).join('\n')}

Content of relevant files:
${Object.entries(filesContent).map(([f, c]) => `=== FILE: ${f} ===\n${c}\n=== END ===`).join('\n\n')}

Build/Runtime error logs (Cleaned & Compressed):
${compressedLogs}`;

    const raw = await callAI(systemPrompt, userPrompt, 1500, true);
    if (!raw) return null;

    const parsed = safeParseJson(raw);
    return {
      patches: parsed.patches || [],
      description: parsed.description || 'Auto-healing patch applied.'
    };
  } catch (err) {
    console.error('[Auto-Heal] Patch generation error:', err.message);
    return null;
  }
}

/**
 * Apply patches locally to the repository files
 */
function applyPatchLocally(repoPath, patches) {
  const applied = [];
  let diffOutput = '';

  for (const patch of patches) {
    const fullPath = path.join(repoPath, patch.filePath);

    // Create new file
    if (patch.originalContent === '') {
      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, patch.replacementContent, 'utf8');
        applied.push(patch.filePath);
        diffOutput += `\n[NEW FILE] ${patch.filePath}:\n+ ${patch.replacementContent.split('\n').join('\n+ ')}\n`;
      } catch (err) {
        console.error(`[Auto-Heal] Failed to create new file ${patch.filePath}:`, err.message);
      }
      continue;
    }

    if (!fs.existsSync(fullPath)) {
      console.warn(`[Auto-Heal] File does not exist for patching: ${patch.filePath}`);
      continue;
    }

    try {
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      const normalizedContent = normalizeNewlines(fileContent);
      const normalizedOriginal = normalizeNewlines(patch.originalContent);
      const normalizedReplacement = normalizeNewlines(patch.replacementContent);

      if (!normalizedContent.includes(normalizedOriginal)) {
        console.warn(`[Auto-Heal] Match failed in ${patch.filePath}. Trying lines match.`);
        // Try loose matching (ignoring CRLF differences)
        const cleanContent = fileContent.replace(/\r\n/g, '\n');
        const cleanOriginal = patch.originalContent.replace(/\r\n/g, '\n');
        const cleanReplacement = patch.replacementContent.replace(/\r\n/g, '\n');

        if (cleanContent.includes(cleanOriginal)) {
          const newContent = cleanContent.replace(cleanOriginal, cleanReplacement);
          fs.writeFileSync(fullPath, newContent, 'utf8');
          applied.push(patch.filePath);
          diffOutput += `\n[MODIFY] ${patch.filePath}:\n- ${cleanOriginal.split('\n').join('\n- ')}\n+ ${cleanReplacement.split('\n').join('\n+ ')}\n`;
        } else {
          // Fall back to resilient loose indentation matching
          const looseContent = looseReplace(fileContent, patch.originalContent, patch.replacementContent);
          if (looseContent) {
            fs.writeFileSync(fullPath, looseContent, 'utf8');
            applied.push(patch.filePath);
            diffOutput += `\n[MODIFY (LOOSE MATCH)] ${patch.filePath}:\n- ${patch.originalContent.split('\n').join('\n- ')}\n+ ${patch.replacementContent.split('\n').join('\n+ ')}\n`;
          } else {
            console.warn(`[Auto-Heal] Skipping patch for ${patch.filePath} due to content mismatch.`);
          }
        }
        continue;
      }

      const newContent = normalizedContent.replace(normalizedOriginal, normalizedReplacement);
      fs.writeFileSync(fullPath, newContent, 'utf8');
      applied.push(patch.filePath);
      diffOutput += `\n[MODIFY] ${patch.filePath}:\n- ${normalizedOriginal.split('\n').join('\n- ')}\n+ ${normalizedReplacement.split('\n').join('\n+ ')}\n`;
    } catch (err) {
      console.error(`[Auto-Heal] Failed to patch file ${patch.filePath}:`, err.message);
    }
  }

  return { applied, diffOutput };
}

/**
 * Commit and push code updates back to GitHub
 */
async function commitAndPushFix(project, repoPath, strategy, parentDeploymentId) {
  const branchName = project.branch || 'main';
  const token = project.owner?.githubAccessToken;

  if (!token) {
    return 'GitHub updates skipped (owner access token not available).';
  }

  let cloneUrl = project.repoUrl;
  cloneUrl = cloneUrl.replace('https://', `https://${token}@`);

  try {
    // Configure Git author credentials locally inside the repo clone
    await execAsync(`git -C "${repoPath}" config user.name "LaunchLive AI"`);
    await execAsync(`git -C "${repoPath}" config user.email "ai-healer@launchlive.internal"`);

    if (strategy === 'push-on-success') {
      await execAsync(`git -C "${repoPath}" add -A`);
      await execAsync(`git -C "${repoPath}" commit -m "chore(launchlive): auto-heal deployment failure for build ${parentDeploymentId}"`);
      await execAsync(`git -C "${repoPath}" push origin HEAD:${branchName}`);
      return `Pushed commit directly to branch ${branchName}.`;
    } else if (strategy === 'pr') {
      const fixBranch = `launchlive-fix-${parentDeploymentId}`;
      await execAsync(`git -C "${repoPath}" checkout -b ${fixBranch}`);
      await execAsync(`git -C "${repoPath}" add -A`);
      await execAsync(`git -C "${repoPath}" commit -m "chore(launchlive): auto-heal deployment failure for build ${parentDeploymentId}"`);
      await execAsync(`git -C "${repoPath}" push origin ${fixBranch}`);

      const { createPullRequest, createPullRequestComment } = require('./github.service');
      const prTitle = `chore(launchlive): AI Auto-Healing fix for build ${parentDeploymentId}`;
      const prBody = `LaunchLive AI Auto-Healing detected a deployment failure and successfully generated/verified a patch.
      
### Applied Patches:
The container was built and verified successfully using this patch. Feel free to merge this PR.`;

      const pr = await createPullRequest(token, project.repoFullName, prTitle, fixBranch, branchName, prBody);

      try {
        const commentBody = `### 🤖 LaunchLive SRE Auto-Healing Report
        
LaunchLive successfully resolved a deployment failure in build **#${parentDeploymentId}**.

| Component | Status | Details |
| --- | --- | --- |
| **Patch Application** | Success ✅ | Patched files locally and validated build |
| **SRE Health Check** | Passed ✅ | Verified container is healthy and responding |
| **Commit Strategy** | Pull Request 🔀 | Opened this PR containing the corrective patches |

*Merge this PR to sync your remote branch with these verified SRE fixes.*`;
        await createPullRequestComment(token, project.repoFullName, pr.number, commentBody);
      } catch (commentErr) {
        console.warn('[Auto-Heal] Failed to post PR comment:', commentErr.message);
      }

      return `Created GitHub Pull Request: ${pr.html_url}`;
    }

    return 'GitHub updates skipped (local-only strategy).';
  } catch (err) {
    console.error('[Auto-Heal] Git operation failed:', err.message);
    return `Failed to update GitHub: ${err.message}`;
  }
}

module.exports = {
  generateFixPatch,
  applyPatchLocally,
  commitAndPushFix
};
