<?php
/**
 * Push WooCommerce order events to Now webhooks.
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

final class Now_Shipping_Woo_Order_Sync {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'woocommerce_new_order', array( $this, 'on_new_order' ), 20, 2 );
		add_action( 'woocommerce_order_status_changed', array( $this, 'on_status_changed' ), 20, 4 );
	}

	/**
	 * @param int|mixed $order_id
	 * @param WC_Order|mixed $order
	 */
	public function on_new_order( $order_id, $order = null ) {
		if ( ! get_option( 'now_shipping_installation_token' ) ) {
			return;
		}
		if ( is_a( $order, 'WC_Order' ) ) {
			$wc_order = $order;
		} else {
			$wc_order = wc_get_order( (int) $order_id );
		}
		if ( ! $wc_order ) {
			return;
		}
		$this->send( 'orders/create', self::build_payload_from_order( $wc_order ) );
	}

	/**
	 * @param int    $order_id
	 * @param string $from
	 * @param string $to
	 * @param WC_Order $order
	 */
	public function on_status_changed( $order_id, $from, $to, $order ) {
		if ( ! get_option( 'now_shipping_installation_token' ) ) {
			return;
		}
		if ( ! is_a( $order, 'WC_Order' ) ) {
			return;
		}
		if ( $to !== 'cancelled' ) {
			return;
		}
		$this->send( 'orders/updated', self::build_payload_from_order( $order ) );
	}

	/**
	 * Build WooCommerce REST-like order array.
	 *
	 * @param WC_Order $order
	 * @return array<string,mixed>
	 */
	public static function build_payload_from_order( WC_Order $order ) {
		$ship = array(
			'first_name' => $order->get_shipping_first_name(),
			'last_name'  => $order->get_shipping_last_name(),
			'company'    => $order->get_shipping_company(),
			'address_1'  => $order->get_shipping_address_1(),
			'address_2'  => $order->get_shipping_address_2(),
			'city'       => $order->get_shipping_city(),
			'state'      => $order->get_shipping_state(),
			'postcode'   => $order->get_shipping_postcode(),
			'country'    => $order->get_shipping_country(),
			'phone'      => $order->get_shipping_phone() ?: $order->get_billing_phone(),
		);

		$items = array();
		foreach ( $order->get_items() as $item ) {
			if ( ! is_a( $item, 'WC_Order_Item_Product' ) ) {
				continue;
			}
			$product = $item->get_product();
			$items[] = array(
				'name'       => $item->get_name(),
				'quantity'   => $item->get_quantity(),
				'virtual'    => $product ? $product->get_virtual() : false,
			);
		}

		$shipping_lines = array();
		foreach ( $order->get_shipping_methods() as $ship_item ) {
			$shipping_lines[] = array(
				'method_title' => $ship_item->get_name(),
				'method_id'    => $ship_item->get_method_id(),
			);
		}

		return array(
			'id'                 => $order->get_id(),
			'number'             => $order->get_order_number(),
			'status'             => $order->get_status(),
			'currency'           => $order->get_currency(),
			'total'              => (string) $order->get_total(),
			'payment_method'     => $order->get_payment_method(),
			'payment_method_title'=> $order->get_payment_method_title(),
			'date_paid'          => $order->get_date_paid() ? $order->get_date_paid()->date( 'c' ) : null,
			'date_created'       => $order->get_date_created() ? $order->get_date_created()->date( 'c' ) : null,
			'date_modified'      => $order->get_date_modified() ? $order->get_date_modified()->date( 'c' ) : null,
			'shipping'           => $ship,
			'billing'            => array(
				'first_name' => $order->get_billing_first_name(),
				'last_name'  => $order->get_billing_last_name(),
				'phone'      => $order->get_billing_phone(),
			),
			'line_items'         => $items,
			'shipping_lines'     => $shipping_lines,
		);
	}

	/**
	 * @param string               $topic
	 * @param array<string,mixed> $order_payload
	 */
	private function send( $topic, $order_payload ) {
		$base = rtrim( (string) get_option( 'now_shipping_api_base', '' ), '/' );
		$sec  = (string) get_option( 'now_shipping_shared_secret', '' );
		if ( ! $base || ! $sec ) {
			return;
		}

		$store_url = home_url( '/' );
		$body_arr  = array(
			'storeUrl' => $store_url,
			'order'    => $order_payload,
		);
		$body      = wp_json_encode( $body_arr );
		$ts        = (string) (int) round( microtime( true ) * 1000 );
		$sig       = hash_hmac( 'sha256', $body, $sec );

		wp_remote_post(
			$base . '/api/woocommerce/webhooks',
			array(
				'timeout'  => 15,
				'blocking' => false,
				'headers'  => array(
					'Content-Type'    => 'application/json; charset=utf-8',
					'X-Now-Topic'     => $topic,
					'X-Now-Signature' => $sig,
					'X-Now-Timestamp' => $ts,
				),
				'body'     => $body,
			)
		);
	}
}
