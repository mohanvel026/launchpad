const puppeteer = require('puppeteer');

// Persistent browser instance to make screenshots ultra-fast
let persistentBrowser = null;

const getBrowser = async () => {
  if (!persistentBrowser) {
    persistentBrowser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });
  }
  return persistentBrowser;
};

/**
 * Launches a headless browser tab to take a lightning-fast screenshot of a given URL.
 * @param {string} url - The URL to screenshot.
 * @returns {Promise<Buffer|null>} - The screenshot buffer, or null if failed.
 */
const takeScreenshot = async (url) => {
  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    // Ultra-fast timeout
    await page.setDefaultNavigationTimeout(8000);

    // DomContentLoaded is much faster than networkidle2. 
    // Phishing sites usually have static login forms that render instantly.
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait only 500ms for visual paint
    await new Promise(r => setTimeout(r, 500));

    // Capture compressed, low-res screenshot to upload to AI instantly
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 50,
      fullPage: false
    });

    return screenshotBuffer;
  } catch (error) {
    console.error('[Sandbox] Headless browser screenshot failed:', error.message);
    return null;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
};

module.exports = {
  takeScreenshot
};
