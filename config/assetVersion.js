/**
 * Bumps on every Node/PM2 process start so static asset URLs change after deploy/restart.
 * Override with ASSET_VERSION env when you need a fixed build id in CI.
 */
const assetVersion =
  process.env.ASSET_VERSION ||
  process.env.npm_package_version ||
  String(Date.now());

module.exports = { assetVersion };
