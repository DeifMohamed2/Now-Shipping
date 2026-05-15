<?php
/**
 * REST: allow Now to post tracking (HMAC).
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

final class Now_Shipping_Woo_Rest_Tracking {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'rest_api_init', array( $this, 'register' ) );
	}

	public function register() {
		register_rest_route(
			'now-shipping/v1',
			'/tracking',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'handle' ),
				// Public route: Now Shipping authenticates each request via HMAC + timestamp in handle().
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * @param WP_REST_Request $req
	 * @return WP_REST_Response|WP_Error
	 */
	public function handle( $req ) {
		$sec = (string) get_option( 'now_shipping_shared_secret', '' );
		if ( $sec === '' ) {
			return new WP_Error( 'not_configured', 'Missing shared secret', array( 'status' => 500 ) );
		}

		$raw = $req->get_body();
		$sig = (string) $req->get_header( 'x_now_signature' );
		$ts  = (string) $req->get_header( 'x_now_timestamp' );
		if ( ! $sig || ! $ts ) {
			return new WP_Error( 'bad_request', 'Missing signature', array( 'status' => 400 ) );
		}
		$now = (int) round( microtime( true ) * 1000 );
		if ( abs( $now - (int) $ts ) > 5 * 60 * 1000 ) {
			return new WP_Error( 'stale', 'Invalid timestamp', array( 'status' => 401 ) );
		}
		$expected = hash_hmac( 'sha256', $raw, $sec );
		if ( ! hash_equals( $expected, $sig ) ) {
			return new WP_Error( 'forbidden', 'Bad signature', array( 'status' => 401 ) );
		}

		$data = json_decode( $raw, true );
		if ( ! is_array( $data ) ) {
			return new WP_Error( 'bad_json', 'Invalid JSON', array( 'status' => 400 ) );
		}

		$order_id = isset( $data['wc_order_id'] ) ? absint( $data['wc_order_id'] ) : 0;
		$track    = isset( $data['tracking_number'] ) ? sanitize_text_field( (string) $data['tracking_number'] ) : '';
		if ( ! $order_id || $track === '' ) {
			return new WP_Error( 'bad_payload', 'wc_order_id and tracking_number required', array( 'status' => 400 ) );
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return new WP_Error( 'not_found', 'Order not found', array( 'status' => 404 ) );
		}

		$order->update_meta_data( '_now_tracking_number', $track );
		if ( ! empty( $data['tracking_url'] ) ) {
			$order->update_meta_data( '_now_tracking_url', esc_url_raw( (string) $data['tracking_url'] ) );
		}
		$order->add_order_note( 'Now Shipping: tracking ' . $track );
		$order->save();

		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}
}
