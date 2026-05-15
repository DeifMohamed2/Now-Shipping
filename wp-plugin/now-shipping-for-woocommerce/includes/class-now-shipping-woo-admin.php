<?php
/**
 * Order admin actions (import to Now).
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

final class Now_Shipping_Woo_Admin {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_filter( 'woocommerce_order_actions', array( $this, 'order_actions' ) );
		add_action( 'woocommerce_order_action_now_shipping_import', array( $this, 'process_import' ) );
	}

	/**
	 * @param array<string,string> $actions
	 * @return array<string,string>
	 */
	public function order_actions( $actions ) {
		$actions['now_shipping_import'] = __( 'Import to Now Shipping', 'now-shipping-for-woocommerce' );
		return $actions;
	}

	/**
	 * @param WC_Order $order
	 */
	public function process_import( $order ) {
		if ( ! is_a( $order, 'WC_Order' ) ) {
			return;
		}
		$gov  = (string) get_option( 'now_shipping_default_government', '' );
		$zone = (string) get_option( 'now_shipping_default_zone', '' );
		if ( $gov === '' || $zone === '' ) {
			$order->add_order_note( __( 'Now Shipping: set default governorate and zone in WooCommerce → Now Shipping before importing.', 'now-shipping-for-woocommerce' ) );
			return;
		}

		$r = Now_Shipping_Woo_Api::request(
			'/api/woocommerce/app/import-order',
			array(
				'wcOrderId'   => $order->get_id(),
				'government'  => $gov,
				'zone'        => $zone,
			)
		);

		if ( $r['ok'] && is_array( $r['data'] ) && ! empty( $r['data']['orderNumber'] ) ) {
			$order->add_order_note( 'Now Shipping: imported as ' . (string) $r['data']['orderNumber'] );
		} else {
			$err = $r['error'] ?: 'import_failed';
			$order->add_order_note( 'Now Shipping import failed: ' . $err );
		}
	}
}
