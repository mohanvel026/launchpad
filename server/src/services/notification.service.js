const nodemailer = require('nodemailer');

// Create reusable transporter
const createTransporter = () =>
  nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

// Send deploy success or failure notification
const sendDeployNotification = async (toEmail, { projectName, status, url, commitMsg }) => {
  if (!process.env.SMTP_USER || !toEmail) return;

  const isSuccess = status === 'success';
  const subject   = isSuccess
    ? `✅ ${projectName} deployed successfully`
    : `❌ ${projectName} deployment failed`;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 0; background: #05050f; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08);">
      <div style="background: linear-gradient(135deg, #0d0d1a 0%, #12122a 100%); padding: 32px 32px 24px; border-bottom: 1px solid rgba(255,255,255,0.07);">
        <div style="margin-bottom: 20px;">
          <span style="font-size: 15px; font-weight: 700; color: #38bdf8;">🚀 LaunchLive</span>
        </div>
        <div style="font-size: 32px; margin-bottom: 12px">${isSuccess ? '✅' : '❌'}</div>
        <h2 style="font-size: 20px; font-weight: 700; color: #e2e8f0; margin: 0 0 8px;">${subject}</h2>
        <p style="color: #64748b; font-size: 14px; margin: 0;">
          Commit: <code style="background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 6px; color: #94a3b8; font-size: 12px;">${commitMsg || 'Manual deploy'}</code>
        </p>
      </div>
      <div style="padding: 24px 32px 32px;">
        <a href="${url}"
          style="display:inline-block;padding:12px 24px;background:${isSuccess ? '#38bdf8' : '#ef4444'};color:#fff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">
          ${isSuccess ? 'View Live App →' : 'View Deployment Logs →'}
        </a>
        <p style="color: #334155; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05);">
          LaunchLive &middot; <a href="https://launchlive.in" style="color: #38bdf8; text-decoration: none;">launchlive.in</a> &middot; Your cloud deployment platform
        </p>
      </div>
    </div>
  `;

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from:    `"LaunchLive" <${process.env.SMTP_USER}>`,
      to:      toEmail,
      subject,
      html,
    });
    console.log(`Deploy notification sent to ${toEmail}`);
  } catch (err) {
    console.warn('Email notification failed:', err.message);
    // Never throw — email failure should not break the deploy flow
  }
};

// Send collaborator invite email
const sendCollaboratorInvite = async (toEmail, { inviterName, projectName, projectUrl }) => {
  if (!process.env.SMTP_USER || !toEmail) return;
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from:    `"LaunchLive" <${process.env.SMTP_USER}>`,
      to:      toEmail,
      subject: `${inviterName} invited you to collaborate on ${projectName}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 0; background: #05050f; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08);">
          <div style="background: linear-gradient(135deg, #0d0d1a 0%, #12122a 100%); padding: 32px; border-bottom: 1px solid rgba(255,255,255,0.07);">
            <h2 style="font-size: 20px; font-weight: 700; color: #e2e8f0; margin: 0 0 8px;">You've been invited! 🎉</h2>
            <p style="color: #94a3b8; font-size: 14px; margin: 0;">
              <strong style="color: #e2e8f0;">${inviterName}</strong> invited you to collaborate on
              <strong style="color: #38bdf8;">${projectName}</strong> on LaunchLive.
            </p>
          </div>
          <div style="padding: 24px 32px 32px;">
            <a href="${projectUrl}"
              style="display:inline-block;padding:12px 24px;background:#38bdf8;color:#fff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">
              View Project →
            </a>
            <p style="color: #334155; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05);">
              LaunchLive &middot; <a href="https://launchlive.in" style="color: #38bdf8; text-decoration: none;">launchlive.in</a>
            </p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.warn('Invite email failed:', err.message);
  }
};

module.exports = { sendDeployNotification, sendCollaboratorInvite };