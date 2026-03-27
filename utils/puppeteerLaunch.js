/**
 * Server-safe Puppeteer launch: production Linux often lacks a working bundled Chromium
 * or needs system Chrome. Prefer env and common distro paths, then Puppeteer's download.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SYSTEM_CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.GOOGLE_CHROME_BIN,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge-stable',
  '/snap/bin/chromium',
];

function firstExistingExecutable(paths) {
  for (const p of paths) {
    if (!p || typeof p !== 'string') continue;
    const normalized = path.resolve(p);
    if (fs.existsSync(normalized)) return normalized;
  }
  return null;
}

/**
 * Resolve Chrome/Chromium path for Puppeteer.
 * @returns {string|null}
 */
function resolveChromeExecutablePath() {
  const fromEnv = firstExistingExecutable(SYSTEM_CHROME_CANDIDATES);
  if (fromEnv) return fromEnv;

  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (e) {
    console.warn('[puppeteerLaunch] puppeteer.executablePath() failed:', e.message);
  }
  return null;
}

/**
 * Options to pass to puppeteer.launch() for headless PDF on Linux/Docker/VPS.
 * @returns {{ executablePath?: string, headless: boolean|string, args: string[] }}
 */
function getPuppeteerLaunchOptions() {
  const executablePath = resolveChromeExecutablePath();
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--mute-audio',
    '--no-first-run',
    '--font-render-hinting=none',
  ];

  const opts = {
    // Puppeteer v24+: boolean is fine; avoids deprecated "new" string on some hosts
    headless: true,
    args,
  };

  if (executablePath) {
    opts.executablePath = executablePath;
  }

  return opts;
}

module.exports = {
  resolveChromeExecutablePath,
  getPuppeteerLaunchOptions,
};
