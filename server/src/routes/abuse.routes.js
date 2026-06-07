const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const AbuseReport = require('../models/AbuseReport.model');
const Project = require('../models/Project.model');
const { generateAiText } = require('../services/ai.service');
const { stopContainer } = require('../services/docker.service');
const axios = require('axios');

const abuseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 abuse reports per window
  message: { message: 'Too many reports submitted from this IP, please try again later.' },
});

router.post('/', abuseLimiter, async (req, res) => {
  try {
    const { subdomain, reason } = req.body;
    if (!subdomain || !reason) {
      return res.status(400).json({ message: 'Subdomain and reason are required.' });
    }

    const reporterIp = req.ip || req.connection.remoteAddress;

    // Save report
    const report = new AbuseReport({
      subdomain,
      reporterIp,
      reason
    });
    await report.save();

    res.status(201).json({ message: 'Abuse report submitted successfully. We will investigate immediately.' });

    // ── AI Auto-Takedown Logic (Async) ──────────────────────────────────────────
    (async () => {
      try {
        const project = await Project.findOne({ subdomain });
        if (!project || project.status !== 'live') return;

        // Fetch the live site content
        const DOMAIN = process.env.CLOUDFLARE_DOMAIN || 'launchlive.in';
        const siteUrl = `https://${subdomain}.${DOMAIN}`;
        const siteResponse = await axios.get(siteUrl, { timeout: 10000 }).catch(() => null);
        
        if (!siteResponse || !siteResponse.data || typeof siteResponse.data !== 'string') return;

        // Take a sample of the HTML
        const htmlSample = siteResponse.data.substring(0, 5000);

        const prompt = `Act as an expert cybersecurity analyst. A user reported this webpage for abuse. Reason given: "${reason}".
Examine the following HTML source code from the live website. Is this a phishing page, scam, or fake login portal?
HTML Source:
${htmlSample}

Reply in strict JSON format:
{
  "isPhishing": true/false,
  "confidence": 0-100,
  "reasoning": "Explanation"
}`;

        const aiResponseStr = await generateAiText(prompt, true);
        const aiResponse = JSON.parse(aiResponseStr);

        report.aiAnalysis = aiResponse;

        if (aiResponse.isPhishing && aiResponse.confidence >= 80) {
          console.log(`[ABUSE] Auto-takedown triggered for ${subdomain}. Reason: ${aiResponse.reasoning}`);
          if (project.containerId) {
            await stopContainer(project.containerId).catch(() => {});
          }
          project.status = 'suspended';
          project.deploymentLogs.push({ ts: new Date(), msg: 'Project automatically suspended by AI due to confirmed phishing report.' });
          await project.save();

          report.actionTaken = 'suspended';
          report.status = 'resolved';
        } else {
          report.status = 'investigating';
        }
        await report.save();
      } catch (err) {
        console.error('[ABUSE] Auto-takedown evaluation failed:', err.message);
      }
    })();
  } catch (error) {
    console.error('Abuse report error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
