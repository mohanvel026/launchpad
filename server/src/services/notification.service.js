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
    <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
      <div style="font-size: 28px; margin-bottom: 8px">${isSuccess ? '✅' : '❌'}</div>
      <h2 style="font-size: 20px; margin: 0 0 8px;">${subject}</h2>
      <p style="color: #555; font-size: 14px; margin: 0 0 16px;">
        Commit: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">${commitMsg || 'Manual deploy'}</code>
      </p>
      <a href="${url}"
        style="display:inline-block;padding:10px 20px;background:${isSuccess ? '#0070f3' : '#ef4444'};color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">
        ${isSuccess ? 'View Live App' : 'View Deployment Logs'}
      </a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
        LaunchPad — your free deployment platform
      </p>
    </div>
  `;

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from:    `"LaunchPad" <${process.env.SMTP_USER}>`,
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
      from:    `"LaunchPad" <${process.env.SMTP_USER}>`,
      to:      toEmail,
      subject: `${inviterName} invited you to collaborate on ${projectName}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; padding: 2rem;">
          <h2 style="font-size: 20px;">You've been invited! 🎉</h2>
          <p style="color:#555;font-size:14px;">
            <strong>${inviterName}</strong> invited you to collaborate on <strong>${projectName}</strong> on LaunchPad.
          </p>
          <a href="${projectUrl}"
            style="display:inline-block;padding:10px 20px;background:#0070f3;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;">
            View Project
          </a>
        </div>
      `,
    });
  } catch (err) {
    console.warn('Invite email failed:', err.message);
  }
};

module.exports = { sendDeployNotification, sendCollaboratorInvite };