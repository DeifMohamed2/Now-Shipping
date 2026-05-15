# WordPress.org submission (optional)

If you submit a copy to [wordpress.org/plugins](https://wordpress.org/plugins/):

## Before you zip for upload

1. **GPLv2+** codebase only (this plugin declares GPL-2.0-or-later).
2. **No dev hosts** in the plugin: `Plugin URI`, `Author URI`, `NOW_SHIPPING_WOO_DEFAULT_ORIGIN`, and `readme.txt` must use real production URLs (e.g. `https://now.com.eg`), not tunnels.
3. **WordPress.org vs self-hosted**: The plugin in this repo is shaped for **wordpress.org** — no `Update URI` header and no `includes/class-now-shipping-woo-updater.php` (directory updates come from SVN). For **self-hosted** installs only, you may restore an updater class + header in a private fork; the Node route `GET /api/woocommerce/plugin/latest` remains available for that use case.
4. **readme.txt**: Set `Tested up to` to a WordPress version you actually tested; align `Contributors:` with real wordpress.org usernames.
5. **Assets** (SVN `assets/`): add `icon-128.png`, `icon-256.png`, `banner-772x250.png` (and optional screenshots).
6. **Plugin Check** plugin: run it on the submission build and fix issues (or document agreed false positives).
7. **External service**: settings copy should make clear that data is sent to Now Shipping when the merchant connects (already described in readme).
8. Review [Detailed Plugin Guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/).
