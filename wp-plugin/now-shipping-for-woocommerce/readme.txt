=== Now Shipping for WooCommerce ===
Contributors: nowshipping
Tags: shipping, woocommerce, egypt, delivery, now
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Sync Egypt delivery orders from WooCommerce into your Now Shipping business account.

== Description ==

Requires an active Now Shipping business account. Generate a pairing code in Now (Business → Settings → Integrations → WooCommerce), install this plugin, then connect your store.

Features:

* Pairing-based connection (no OAuth on the WordPress side)
* Automatic push of new orders and cancellations to Now
* Manual "Import to Now Shipping" order action (configure default governorate/zone in plugin settings)
* Optional WooCommerce REST keys for server-side order listing in Now

== Installation ==

1. Upload the plugin ZIP via Plugins → Add New → Upload.
2. Activate the plugin (WooCommerce must be active).
3. In Now dashboard, open Business → Settings → Integrations → WooCommerce → Generate pairing code.
4. In WordPress: WooCommerce → Now Shipping → Connect with pairing code.

== Frequently Asked Questions ==

= Where do I get REST API keys? =

WooCommerce → Settings → Advanced → REST API. Create a key with **Read** permission.

== Changelog ==

= 1.0.1 =
* Fix Plugin Check warnings (input sanitization, nonce verification, prefixed globals).
* Remove self-hosted updater for WordPress.org compatibility.
* Update Tested up to 6.9.

= 1.0.0 =
* Initial release.
