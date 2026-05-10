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
const API_URL = process.env.LAUNCHPAD_API || 'https://api.launchpad.dev/api';

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
          console.log(`            ${chalk.cyan(`https://${p.subdomain}.launchpad.dev`)}`);
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

    // If project ID given — redeploy it
    if (options.project) {
      const spinner = ora('Triggering deployment…').start();
      try {
        const res = await api().post(`/deploy/${options.project}`);
        spinner.succeed(chalk.green('Deployment queued!'));
        console.log(chalk.gray(`  Deployment ID: ${res.data.deployment._id}`));
        console.log(`  Run ${chalk.cyan(`launchpad logs ${options.project}`)} to see live logs`);
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
      console.log(`  ${chalk.bold('URL:')}     ${chalk.cyan(`https://${project.data.project.subdomain}.launchpad.dev`)}`);
      console.log(`  ${chalk.bold('ID:')}      ${project.data.project._id}`);
      console.log(`\n  Run ${chalk.cyan(`launchpad logs ${project.data.project._id}`)} to follow live logs\n`);
    } catch (err) {
      spinner.fail(chalk.red(err.response?.data?.message || err.message));
    }
  });

// LOGS
program
  .command('logs <projectId>')
  .description('View deployment logs for a project')
  .option('-f, --follow', 'Follow live logs via polling')
  .action(async (projectId, options) => {
    requireAuth();
    const spinner = ora('Fetching logs…').start();
    try {
      const deps = await api().get(`/deploy/${projectId}`);
      const latest = deps.data.deployments[0];
      if (!latest) { spinner.fail('No deployments found'); return; }

      const res = await api().get(`/deploy/${projectId}/${latest._id}`);
      spinner.stop();

      const dep  = res.data.deployment;
      console.log(chalk.bold(`\n  Deployment: ${dep._id}`));
      console.log(`  Status:  ${formatStatus(dep.status)}`);
      console.log(`  Commit:  ${dep.commitMessage || 'manual'} (${dep.commitSha})`);
      console.log(`  Branch:  ${dep.branch}`);
      if (dep.duration) console.log(`  Time:    ${(dep.duration / 1000).toFixed(1)}s`);
      console.log(chalk.bold('\n  Logs:\n'));

      (dep.logs || []).forEach((line) => {
        const color = line.includes('❌') ? chalk.red : line.includes('✅') ? chalk.green : line.includes('🤖') ? chalk.magenta : chalk.gray;
        console.log('  ' + color(line));
      });

      if (dep.aiErrorSummary) {
        console.log(chalk.magenta(`\n  🤖 AI Diagnosis: ${dep.aiErrorSummary}\n`));
      }
    } catch (err) {
      spinner.fail(chalk.red(err.response?.data?.message || err.message));
    }
  });

// STATUS
program
  .command('status <projectId>')
  .description('Get project status and URL')
  .action(async (projectId) => {
    requireAuth();
    try {
      const res     = await api().get(`/projects/${projectId}`);
      const project = res.data.project;
      console.log(chalk.bold(`\n  ${project.name}\n`));
      console.log(`  Status:  ${formatStatus(project.status)}`);
      console.log(`  Stack:   ${project.stack || 'unknown'}`);
      console.log(`  Repo:    ${project.repoFullName} (${project.branch})`);
      console.log(`  Deploys: ${project.buildCount}`);
      if (project.subdomain) {
        console.log(`  URL:     ${chalk.cyan(`https://${project.subdomain}.launchpad.dev`)}`);
      }
      console.log();
    } catch (err) {
      console.log(chalk.red('✗ ' + (err.response?.data?.message || err.message)));
    }
  });

// ENV
program
  .command('env <projectId>')
  .description('Manage environment variables')
  .option('-s, --set <KEY=VALUE>', 'Set an env var')
  .option('-d, --delete <KEY>', 'Delete an env var')
  .option('-l, --list', 'List env var keys')
  .action(async (projectId, options) => {
    requireAuth();

    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const value = valueParts.join('=');
      if (!key || !value) { console.log(chalk.red('Format: --set KEY=VALUE')); return; }
      try {
        await api().post(`/env/${projectId}`, { key, value });
        console.log(chalk.green(`✓ ${key} set`));
      } catch (err) {
        console.log(chalk.red('✗ ' + err.message));
      }
      return;
    }

    if (options.delete) {
      try {
        await api().delete(`/env/${projectId}/${options.delete}`);
        console.log(chalk.green(`✓ ${options.delete} deleted`));
      } catch (err) {
        console.log(chalk.red('✗ ' + err.message));
      }
      return;
    }

    // Default: list
    try {
      const res = await api().get(`/env/${projectId}`);
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

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}