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

/**
 * GET /api/woocommerce/plugin/download — redirect to ZIP URL from manifest or env
 */
function getPluginDownload(req, res) {
  try {
    let manifest = null;
    if (process.env.WOOCOMMERCE_PLUGIN_LATEST_JSON) {
      manifest = JSON.parse(process.env.WOOCOMMERCE_PLUGIN_LATEST_JSON);
    } else {
      const fp = path.join(__dirname, '..', 'public', 'woocommerce-plugin-latest.json');
      if (fs.existsSync(fp)) {
        manifest = JSON.parse(fs.readFileSync(fp, 'utf8'));
      }
    }
    const url = manifest && manifest.download_url;
    if (!url) {
      return res.status(404).send('Plugin package URL not configured.');
    }
    return res.redirect(302, url);
  } catch (err) {
    console.error('[woocommercePlugin] download:', err.message || err);
    return res.status(500).send('Download unavailable');
  }
}

module.exports = { getPluginLatest, getPluginDownload };
