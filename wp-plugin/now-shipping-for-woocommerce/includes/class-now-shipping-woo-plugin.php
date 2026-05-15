<?php
/**
 * Core plugin loader.
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

final class Now_Shipping_Woo_Plugin {

	/**
	 * @var self|null
	 */
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'plugins_loaded', array( $this, 'on_plugins_loaded' ) );
	}

	public function on_plugins_loaded() {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( $this, 'notice_missing_wc' ) );
			return;
		}

		require_once NOW_SHIPPING_WOO_PATH . 'includes/class-now-shipping-woo-api.php';
		require_once NOW_SHIPPING_WOO_PATH . 'includes/class-now-shipping-woo-settings.php';
		require_once NOW_SHIPPING_WOO_PATH . 'includes/class-now-shipping-woo-order-sync.php';
		require_once NOW_SHIPPING_WOO_PATH . 'includes/class-now-shipping-woo-rest-tracking.php';
		require_once NOW_SHIPPING_WOO_PATH . 'includes/class-now-shipping-woo-admin.php';

		Now_Shipping_Woo_Settings::instance();
		Now_Shipping_Woo_Order_Sync::instance();
		Now_Shipping_Woo_Rest_Tracking::instance();
		Now_Shipping_Woo_Admin::instance();
	}

	public function notice_missing_wc() {
		echo '<div class="notice notice-error"><p>';
		echo esc_html__( 'Now Shipping for WooCommerce requires WooCommerce.', 'now-shipping-for-woocommerce' );
		echo '</p></div>';
	}
}
