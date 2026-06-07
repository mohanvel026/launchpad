const puppeteer = require('puppeteer');

/**
 * Launches a headless browser to take a screenshot of a given URL.
 * @param {string} url - The URL to screenshot.
 * @returns {Promise<Buffer|null>} - The screenshot buffer, or null if failed.
 */
const takeScreenshot = async (url) => {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });

    const page = await browser.newPage();
    
    // Set a reasonable timeout so we don't hang the worker indefinitely
    await page.setDefaultNavigationTimeout(15000);

    // Go to the local container URL
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Give it a tiny bit extra time to render any lazy-loaded JS
    await new Promise(r => setTimeout(r, 2000));

    // Capture screenshot
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage: false
    });

    return screenshotBuffer;
  } catch (error) {
    console.error('[Sandbox] Headless browser screenshot failed:', error.message);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};

module.exports = {
  takeScreenshot
};
