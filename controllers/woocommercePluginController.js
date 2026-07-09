const fs = require('fs');
const path = require('path');

/**
 * GET /api/woocommerce/plugin/latest — JSON manifest for optional self-hosted WP updates (no longer consumed by the bundled plugin when built for wordpress.org).
 * Override with file `public/woocommerce-plugin-latest.json` or env WOOCOMMERCE_PLUGIN_LATEST_JSON (raw JSON string).
 */
function getPluginLatest(req, res) {
  try {
    if (process.env.WOOCOMMERCE_PLUGIN_LATEST_JSON) {
      const data = JSON.parse(process.env.WOOCOMMERCE_PLUGIN_LATEST_JSON);
      return res.json(data);
    }
    const fp = path.join(__dirname, '..', 'public', 'woocommerce-plugin-latest.json');
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      return res.json(data);
    }
    return res.status(404).json({
      error: 'not_configured',
      message: 'Create public/woocommerce-plugin-latest.json or set WOOCOMMERCE_PLUGIN_LATEST_JSON',
    });
  } catch (err) {
    console.error('[woocommercePlugin] latest:', err.message || err);
    return res.status(500).json({ error: 'invalid_plugin_manifest' });
  }
}

function loadPluginManifest() {
  if (process.env.WOOCOMMERCE_PLUGIN_LATEST_JSON) {
    return JSON.parse(process.env.WOOCOMMERCE_PLUGIN_LATEST_JSON);
  }
  const fp = path.join(__dirname, '..', 'public', 'woocommerce-plugin-latest.json');
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  }
  return null;
}

function localPluginZipPath(manifest) {
  const version = (manifest && manifest.version) || '1.0.1';
  const candidates = [
    path.join(__dirname, '..', 'public', 'downloads', `now-shipping-for-woocommerce-${version}.zip`),
    path.join(__dirname, '..', 'public', 'downloads', 'now-shipping-for-woocommerce-1.0.1.zip'),
    path.join(__dirname, '..', 'public', 'downloads', 'now-shipping-for-woocommerce-1.0.0.zip'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * GET /api/woocommerce/plugin/download — redirect to ZIP URL from manifest, or serve local ZIP fallback
 */
function getPluginDownload(req, res) {
  try {
    const manifest = loadPluginManifest();
    const url = manifest && manifest.download_url;
    if (url) {
      return res.redirect(302, url);
    }
    const localZip = localPluginZipPath(manifest);
    if (localZip) {
      return res.download(localZip, path.basename(localZip));
    }
    return res.status(404).send('Plugin package URL not configured.');
  } catch (err) {
    console.error('[woocommercePlugin] download:', err.message || err);
    return res.status(500).send('Download unavailable');
  }
}

module.exports = { getPluginLatest, getPluginDownload };
