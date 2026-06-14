const axios = require('axios');
const Webhook = require('../models/Webhook.model');

const notifyWebhooks = async (projectId, eventType, data) => {
  try {
    const webhooks = await Webhook.find({ project: projectId, events: eventType });
    if (!webhooks.length) return;

    const { projectName, branch, commitSha, commitMessage, aiDiagnosis, liveUrl } = data;

    for (const hook of webhooks) {
      try {
        let payload = {};
        const isSlack = hook.type === 'slack';

        // Styling
        let colorHex = '#38bdf8'; // Blue for building
        let colorDecimal = 3718648; 
        let title = `🚀 Build Started: ${projectName}`;
        let description = `A new deployment has been queued on branch \`${branch}\`.`;

        if (eventType === 'success') {
          colorHex = '#10b981'; // Green for success
          colorDecimal = 1096065;
          title = `✅ Build Success: ${projectName}`;
          description = `Deployment has completed successfully!\n\n🔗 **Live URL**: ${liveUrl}`;
        } else if (eventType === 'failure') {
          colorHex = '#ef4444'; // Red for failure
          colorDecimal = 15680580;
          title = `❌ Build Failed: ${projectName}`;
          description = `Build crashed on branch \`${branch}\`.\n\n🤖 **SRE Diagnosis**:\n` +
            `• *Root Cause*: ${aiDiagnosis?.cause || 'Unknown failure'}\n` +
            `• *Fix*: ${aiDiagnosis?.fix || 'Check build logs for details.'}`;
        }

        const dashboardUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/projects/${projectId}`;
        let slackActionLinks = `<${dashboardUrl}|💻 Open Dashboard>`;
        let discordActionLinks = `[💻 Open Dashboard](${dashboardUrl})`;

        if (eventType === 'success' && liveUrl) {
          slackActionLinks += `  |  <${liveUrl}|🔗 Open Live Preview>`;
          discordActionLinks += `  |  [🔗 Open Live Preview](${liveUrl})`;
        } else if (eventType === 'failure') {
          slackActionLinks += `  |  <${dashboardUrl}|🤖 Run AI Auto-Heal>`;
          discordActionLinks += `  |  [🤖 Run AI Auto-Heal](${dashboardUrl})`;
        }

        if (isSlack) {
          payload = {
            text: title,
            attachments: [{
              color: colorHex,
              title: title,
              text: description,
              fields: [
                { title: 'Branch', value: branch, short: true },
                { title: 'Commit', value: commitSha ? `${commitSha} - ${commitMessage}` : 'N/A', short: true },
                { title: 'Quick Actions', value: slackActionLinks, short: false }
              ],
              footer: 'LaunchLive CI/CD Alert'
            }]
          };
        } else {
          // Discord format
          payload = {
            embeds: [{
              title: title,
              description: description,
              color: colorDecimal,
              fields: [
                { name: 'Branch', value: branch, inline: true },
                { name: 'Commit', value: commitSha ? `\`${commitSha}\` - ${commitMessage}` : 'N/A', inline: true },
                { name: 'Quick Actions', value: discordActionLinks, inline: false }
              ],
              timestamp: new Date().toISOString(),
              footer: { text: 'LaunchLive CI/CD Alert' }
            }]
          };
        }

        await axios.post(hook.url, payload, { timeout: 8000 });
      } catch (err) {
        console.error(`[Webhook Notifier] Failed to send to ${hook.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Webhook Notifier] Global failure:', err.message);
  }
};

module.exports = { notifyWebhooks };
