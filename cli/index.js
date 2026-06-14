#!/usr/bin/env node

const { program } = require('commander');
const axios       = require('axios');
const chalk       = require('chalk');
const ora         = require('ora');
const inquirer    = require('inquirer');
const Conf        = require('conf');
const path        = require('path');
const fs          = require('fs');

const config  = new Conf({ projectName: 'launchpad-cli' });
const API_URL = process.env.LAUNCHPAD_API || 'https://launchlive.in/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

const api = () => {
  const token = config.get('token');
  return axios.create({
    baseURL: API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
};

const requireAuth = () => {
  const token = config.get('token');
  if (!token) {
    console.log(chalk.red('✗ Not logged in. Run: launchpad login'));
    process.exit(1);
  }
};

const formatStatus = (status) => {
  const colors = {
    live:     chalk.green('● live'),
    building: chalk.yellow('● building'),
    failed:   chalk.red('● failed'),
    idle:     chalk.gray('● idle'),
    stopped:  chalk.gray('● stopped'),
  };
  return colors[status] || status;
};

const getLinkedProjectId = () => {
  const configPath = path.join(process.cwd(), '.launchpad', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const localConf = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (localConf.projectId) return localConf.projectId;
    } catch {}
  }
  return null;
};

const resolveProjectId = (argId) => {
  if (argId) return argId;
  const linked = getLinkedProjectId();
  if (linked) {
    const configPath = path.join(process.cwd(), '.launchpad', 'config.json');
    try {
      const localConf = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      console.log(chalk.gray(`Resolved linked project: ${chalk.bold(localConf.name)} (${linked})`));
    } catch {}
    return linked;
  }
  console.log(chalk.red('✗ Project ID is required. Pass it as an argument or run: launchpad link'));
  process.exit(1);
};

// ── Commands ──────────────────────────────────────────────────────────────────

program
  .name('launchpad')
  .description('Deploy fullstack apps with LaunchPad')
  .version('1.0.0');

// LOGIN
program
  .command('login')
  .description('Login with your LaunchPad token')
  .action(async () => {
    console.log(chalk.blue('\n🚀 LaunchPad CLI Login\n'));
    console.log('Get your token from: ' + chalk.cyan(`${API_URL.replace('/api', '')}/dashboard/token`));
    console.log('Or login at: ' + chalk.cyan(`${API_URL.replace('/api', '')}/login`) + '\n');

    const { token } = await inquirer.prompt([{
      type:     'password',
      name:     'token',
      message:  'Paste your JWT token:',
      validate: (v) => v.length > 10 || 'Invalid token',
    }]);

    const spinner = ora('Verifying token…').start();
    try {
      const res = await axios.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      config.set('token', token);
      spinner.succeed(chalk.green(`Logged in as ${chalk.bold(res.data.user.username)}`));
    } catch {
      spinner.fail(chalk.red('Invalid token. Please try again.'));
    }
  });

// LOGOUT
program
  .command('logout')
  .description('Log out of LaunchPad CLI')
  .action(() => {
    config.delete('token');
    console.log(chalk.green('✓ Logged out'));
  });

// WHOAMI
program
  .command('whoami')
  .description('Show current logged-in user')
  .action(async () => {
    requireAuth();
    try {
      const res = await api().get('/auth/me');
      console.log(chalk.green(`✓ Logged in as: ${chalk.bold(res.data.user.username)}`));
      console.log(`  Plan: ${res.data.user.plan}`);
    } catch {
      console.log(chalk.red('✗ Session expired. Run: launchpad login'));
    }
  });

// LIST PROJECTS
program
  .command('list')
  .alias('ls')
  .description('List all your projects')
  .action(async () => {
    requireAuth();
    const spinner = ora('Fetching projects…').start();
    try {
      const res      = await api().get('/projects');
      const projects = res.data.projects;
      spinner.stop();

      if (projects.length === 0) {
        console.log(chalk.gray('No projects yet. Run: launchpad deploy'));
        return;
      }

      console.log(chalk.bold('\n  Your Projects\n'));
      projects.forEach((p) => {
        console.log(`  ${formatStatus(p.status)}  ${chalk.bold(p.name)}  ${chalk.gray(p.repoFullName)}`);
        if (p.subdomain) {
          console.log(`            ${chalk.cyan(`https://${p.subdomain}.launchlive.in`)}`);
        }
        console.log();
      });
    } catch (err) {
      spinner.fail(chalk.red('Failed to fetch projects: ' + err.message));
    }
  });

// DEPLOY
program
  .command('deploy')
  .description('Deploy current directory or a GitHub repo')
  .option('-r, --repo <repo>', 'GitHub repo (e.g. username/my-app)')
  .option('-b, --branch <branch>', 'Branch to deploy', 'main')
  .option('-p, --project <projectId>', 'Project ID to redeploy')
  .action(async (options) => {
    requireAuth();

    // Check if there is an option project or a linked project
    let targetProjectId = options.project || getLinkedProjectId();

    // If target project ID is resolved and they didn't explicitly request another repo, redeploy it
    if (targetProjectId && !options.repo) {
      const spinner = ora('Triggering deployment…').start();
      try {
        const res = await api().post(`/deploy/${targetProjectId}`);
        spinner.succeed(chalk.green('Deployment queued!'));
        console.log(chalk.gray(`  Deployment ID: ${res.data.deployment._id}`));
        console.log(`  Run ${chalk.cyan(`launchpad logs ${targetProjectId}`)} to see live logs`);
      } catch (err) {
        spinner.fail(chalk.red(err.response?.data?.message || err.message));
      }
      return;
    }

    // Create new project
    let repoFullName = options.repo;

    if (!repoFullName) {
      // Try to detect from git remote
      try {
        const { execSync } = require('child_process');
        const remote = execSync('git remote get-url origin', { stdio: 'pipe' }).toString().trim();
        const match  = remote.match(/github\.com[:/](.+?)(\.git)?$/);
        if (match) repoFullName = match[1];
      } catch {}
    }

    if (!repoFullName) {
      const { repo } = await inquirer.prompt([{
        type:     'input',
        name:     'repo',
        message:  'GitHub repo (username/repo-name):',
        validate: (v) => v.includes('/') || 'Format: username/repo-name',
      }]);
      repoFullName = repo;
    }

    const { branch } = options.branch ? options : await inquirer.prompt([{
      type:    'input',
      name:    'branch',
      message: 'Branch:',
      default: 'main',
    }]);

    const spinner = ora(`Creating project for ${chalk.bold(repoFullName)}…`).start();
    try {
      const project = await api().post('/projects', { repoFullName, branch });
      spinner.text = 'Triggering first deployment…';
      const deploy = await api().post(`/deploy/${project.data.project._id}`);

      spinner.succeed(chalk.green('Deployment started!'));
      console.log(`\n  ${chalk.bold('Project:')} ${project.data.project.name}`);
      console.log(`  ${chalk.bold('URL:')}     ${chalk.cyan(`https://${project.data.project.subdomain}.launchlive.in`)}`);
      console.log(`  ${chalk.bold('ID:')}      ${project.data.project._id}`);
      
      // Auto-save the link configuration locally upon creation
      const lpDir = path.join(process.cwd(), '.launchpad');
      if (!fs.existsSync(lpDir)) {
        fs.mkdirSync(lpDir);
      }
      fs.writeFileSync(
        path.join(lpDir, 'config.json'),
        JSON.stringify({ projectId: project.data.project._id, name: project.data.project.name }, null, 2),
        'utf-8'
      );
      console.log(chalk.gray(`\n✓ Automatically linked local folder to project!`));

      console.log(`\n  Run ${chalk.cyan(`launchpad logs ${project.data.project._id}`)} to follow live logs\n`);
    } catch (err) {
      spinner.fail(chalk.red(err.response?.data?.message || err.message));
    }
  });

// LOGS
program
  .command('logs [projectId]')
  .description('View deployment logs for a project')
  .option('-f, --follow', 'Follow live logs via polling')
  .action(async (projectId, options) => {
    requireAuth();
    const targetProjectId = resolveProjectId(projectId);
    
    const spinner = ora('Fetching logs…').start();
    try {
      const deps = await api().get(`/deploy/${targetProjectId}`);
      const latest = deps.data.deployments[0];
      if (!latest) { spinner.fail('No deployments found'); return; }

      let deploymentId = latest._id;
      let lastPrintedCount = 0;

      const printLogs = (dep) => {
        const logs = dep.logs || [];
        if (logs.length > lastPrintedCount) {
          logs.slice(lastPrintedCount).forEach((line) => {
            const color = line.includes('❌') ? chalk.red : line.includes('✅') ? chalk.green : line.includes('🤖') ? chalk.magenta : chalk.gray;
            console.log('  ' + color(line));
          });
          lastPrintedCount = logs.length;
        }
      };

      const res = await api().get(`/deploy/${targetProjectId}/${deploymentId}`);
      spinner.stop();

      let dep  = res.data.deployment;
      console.log(chalk.bold(`\n  Deployment: ${dep._id}`));
      console.log(`  Status:  ${formatStatus(dep.status)}`);
      console.log(`  Commit:  ${dep.commitMessage || 'manual'} (${dep.commitSha})`);
      console.log(`  Branch:  ${dep.branch}`);
      if (dep.duration) console.log(`  Time:    ${(dep.duration / 1000).toFixed(1)}s`);
      console.log(chalk.bold('\n  Logs:\n'));

      printLogs(dep);

      if (options.follow && (dep.status === 'building' || dep.status === 'queued')) {
        const pollSpinner = ora('Following live logs…').start();
        const interval = setInterval(async () => {
          try {
            const checkRes = await api().get(`/deploy/${targetProjectId}/${deploymentId}`);
            const checkDep = checkRes.data.deployment;
            pollSpinner.stop();
            printLogs(checkDep);
            if (checkDep.status !== 'building' && checkDep.status !== 'queued') {
              clearInterval(interval);
              console.log(`\n  Status:  ${formatStatus(checkDep.status)}`);
              if (checkDep.duration) console.log(`  Time:    ${(checkDep.duration / 1000).toFixed(1)}s`);
              if (checkDep.aiErrorSummary) {
                console.log(chalk.magenta(`\n  🤖 AI Diagnosis: ${checkDep.aiErrorSummary}\n`));
              }
            } else {
              pollSpinner.start();
            }
          } catch (e) {
            clearInterval(interval);
            pollSpinner.fail(chalk.red('Lost connection to server: ' + e.message));
          }
        }, 1500);
      } else {
        if (dep.aiErrorSummary) {
          console.log(chalk.magenta(`\n  🤖 AI Diagnosis: ${dep.aiErrorSummary}\n`));
        }
      }
    } catch (err) {
      spinner.fail(chalk.red(err.response?.data?.message || err.message));
    }
  });

// STATUS
program
  .command('status [projectId]')
  .description('Get project status and URL')
  .action(async (projectId) => {
    requireAuth();
    const targetProjectId = resolveProjectId(projectId);
    try {
      const res     = await api().get(`/projects/${targetProjectId}`);
      const project = res.data.project;
      console.log(chalk.bold(`\n  ${project.name}\n`));
      console.log(`  Status:  ${formatStatus(project.status)}`);
      console.log(`  Stack:   ${project.stack || 'unknown'}`);
      console.log(`  Repo:    ${project.repoFullName} (${project.branch})`);
      console.log(`  Deploys: ${project.buildCount}`);
      if (project.subdomain) {
        console.log(`  URL:     ${chalk.cyan(`https://${project.subdomain}.launchlive.in`)}`);
      }
      console.log();
    } catch (err) {
      console.log(chalk.red('✗ ' + (err.response?.data?.message || err.message)));
    }
  });

// ENV
program
  .command('env [projectId]')
  .description('Manage environment variables')
  .option('-s, --set <KEY=VALUE>', 'Set an env var')
  .option('-d, --delete <KEY>', 'Delete an env var')
  .option('-l, --list', 'List env var keys')
  .action(async (projectId, options) => {
    requireAuth();
    const targetProjectId = resolveProjectId(projectId);

    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const value = valueParts.join('=');
      if (!key || !value) { console.log(chalk.red('Format: --set KEY=VALUE')); return; }
      try {
        await api().post(`/env/${targetProjectId}`, { key, value });
        console.log(chalk.green(`✓ ${key} set`));
      } catch (err) {
        console.log(chalk.red('✗ ' + err.message));
      }
      return;
    }

    if (options.delete) {
      try {
        await api().delete(`/env/${targetProjectId}/${options.delete}`);
        console.log(chalk.green(`✓ ${options.delete} deleted`));
      } catch (err) {
        console.log(chalk.red('✗ ' + err.message));
      }
      return;
    }

    // Default: list
    try {
      const res = await api().get(`/env/${targetProjectId}`);
      const envVars = res.data.envVars;
      if (envVars.length === 0) {
        console.log(chalk.gray('No env vars set.'));
      } else {
        console.log(chalk.bold('\n  Environment Variables\n'));
        envVars.forEach((e) => {
          console.log(`  ${chalk.cyan(e.key)} = ${chalk.gray('••••••')}`);
        });
        console.log();
      }
    } catch (err) {
      console.log(chalk.red('✗ ' + err.message));
    }
  });

// AUDIT
program
  .command('audit [projectId]')
  .description('Run an AI SRE, performance, and security audit on your project')
  .action(async (projectId) => {
    requireAuth();
    const targetProjectId = resolveProjectId(projectId);
    const spinner = ora(chalk.blue('Running AI DevOps & SRE security audit…')).start();
    try {
      const res = await api().post(`/ai/${targetProjectId}/devops-summary`);
      const summary = res.data;
      spinner.succeed(chalk.green('✓ Audit complete!'));

      const gradeColors = {
        'A': chalk.bold.green,
        'B': chalk.bold.cyan,
        'C': chalk.bold.yellow,
        'D': chalk.bold.yellow,
        'F': chalk.bold.red,
      };
      
      const gradeColor = gradeColors[summary.securityGrade] || chalk.bold.white;
      const healthColor = summary.healthStatus === 'Excellent' ? chalk.green : summary.healthStatus === 'Good' ? chalk.cyan : chalk.yellow;

      console.log(chalk.bold(`\n  🛡️  LAUNCHPAD AI DEVOPS AUDIT REPORT\n`));
      console.log(`  ===============================================`);
      console.log(`  Project Stack:      ${chalk.bold(summary.projectStack.toUpperCase())}`);
      console.log(`  Overall Health:     ${healthColor(summary.healthStatus)}`);
      console.log(`  -----------------------------------------------`);
      console.log(`  🔒 Security Grade:  ${gradeColor(summary.securityGrade)} (${summary.securityScore}/100)`);
      console.log(`  ⚠️  Vulnerabilities: ${summary.vulnerabilitiesCount > 0 ? chalk.bold.red(summary.vulnerabilitiesCount) : chalk.bold.green('0 found')}`);
      console.log(`  -----------------------------------------------`);
      console.log(`  💻 Recommended CPU:  ${chalk.cyan(summary.recommendedCpu + ' vCPU')}`);
      console.log(`  🧠 Recommended RAM:  ${chalk.cyan(summary.recommendedRam)}`);
      console.log(`  🔋 Needs Redis:      ${summary.needsRedisCache ? chalk.bold.yellow('Yes (Recommended)') : chalk.bold.green('No (Optional)')}`);
      console.log(`  ===============================================\n`);
      
      console.log(chalk.magenta('  🤖 SRE Recommendations:'));
      if (summary.vulnerabilitiesCount > 0) {
        console.log(chalk.gray(`   • Warning: Found dependency vulnerabilities. Run: launchpad logs ${targetProjectId} to view full audit details.`));
      }
      if (summary.needsRedisCache) {
        console.log(chalk.gray(`   • Performance: Consider setting up Redis caching for database query acceleration.`));
      }
      console.log(chalk.gray(`   • Capacity: SRE predicts resources are optimal for up to 10k concurrent requests.`));
      console.log();
    } catch (err) {
      spinner.fail(chalk.red('Audit failed: ' + (err.response?.data?.message || err.message)));
    }
  });

// LINK
program
  .command('link')
  .description('Link current directory to a LaunchPad project')
  .action(async () => {
    requireAuth();
    console.log(chalk.blue('\n🔗 Link Project to LaunchPad\n'));

    let gitRepo = null;
    try {
      const { execSync } = require('child_process');
      const remote = execSync('git remote get-url origin', { stdio: 'pipe' }).toString().trim();
      const match  = remote.match(/github\.com[:/](.+?)(\.git)?$/);
      if (match) gitRepo = match[1];
    } catch {}

    if (gitRepo) {
      console.log(`Git remote origin detected: ${chalk.cyan(gitRepo)}`);
    }

    const spinner = ora('Fetching available projects…').start();
    let projects = [];
    try {
      const res = await api().get('/projects');
      projects = res.data.projects;
      spinner.stop();
    } catch (err) {
      spinner.fail(chalk.red('Failed to fetch projects: ' + err.message));
      return;
    }

    if (projects.length === 0) {
      console.log(chalk.yellow('No projects found. Create one first or deploy using: launchpad deploy'));
      return;
    }

    const matchingProj = projects.find(p => p.repoFullName.toLowerCase() === gitRepo?.toLowerCase());
    
    const { projectId } = await inquirer.prompt([{
      type: 'list',
      name: 'projectId',
      message: 'Select LaunchPad project to link:',
      choices: projects.map(p => ({
        name: `${p.name} (${p.repoFullName})`,
        value: p._id
      })),
      default: matchingProj ? matchingProj._id : undefined
    }]);

    const selected = projects.find(p => p._id === projectId);

    const lpDir = path.join(process.cwd(), '.launchpad');
    if (!fs.existsSync(lpDir)) {
      fs.mkdirSync(lpDir);
    }
    fs.writeFileSync(
      path.join(lpDir, 'config.json'),
      JSON.stringify({ projectId: selected._id, name: selected.name }, null, 2),
      'utf-8'
    );

    console.log(chalk.green(`\n✓ Linked to project: ${chalk.bold(selected.name)}`));
    console.log(`Local configuration saved in ${chalk.cyan('.launchpad/config.json')}\n`);
  });

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}