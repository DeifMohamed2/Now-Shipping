<?php
/**
 * Plugin Name:       Now Shipping for WooCommerce
 * Plugin URI:        https://now.com.eg/faq
 * Description:       Sync Egypt delivery orders from WooCommerce into your Now Shipping dashboard. Requires a Now business account and pairing code.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Tested up to:      6.9
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * Author:            Now Shipping
 * Author URI:        https://now.com.eg
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       now-shipping-for-woocommerce
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

/** Default Now API origin (no trailing slash). Override per site in WooCommerce → Now Shipping, or set `APP_URL` on the Node app. */
define( 'NOW_SHIPPING_WOO_DEFAULT_ORIGIN', 'https://now.com.eg' );

define( 'NOW_SHIPPING_WOO_VERSION', '1.0.0' );
define( 'NOW_SHIPPING_WOO_FILE', __FILE__ );
define( 'NOW_SHIPPING_WOO_PATH', plugin_dir_path( __FILE__ ) );
define( 'NOW_SHIPPING_WOO_URL', plugin_dir_url( __FILE__ ) );

require_once NOW_SHIPPING_WOO_PATH . 'includes/class-now-shipping-woo-plugin.php';

register_activation_hook(
	NOW_SHIPPING_WOO_FILE,
	function () {
		if ( ! class_exists( 'WooCommerce' ) && file_exists( ABSPATH . 'wp-admin/includes/plugin.php' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
			deactivate_plugins( plugin_basename( NOW_SHIPPING_WOO_FILE ) );
		}
		flush_rewrite_rules();
	}
);

Now_Shipping_Woo_Plugin::instance();
