<?php
/**
 * HTTP helpers for Now API (Bearer + HMAC).
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

class Now_Shipping_Woo_Api {

	/**
	 * POST JSON to Now with auth headers.
	 *
	 * @param string $path Absolute path starting with /api/...
	 * @param array  $body Body array (encoded as JSON).
	 * @return array{ok:bool, code:int, data:mixed, error:string}
	 */
	public static function request( $path, $body = array() ) {
		$base = rtrim( (string) get_option( 'now_shipping_api_base', '' ), '/' );
		$tok  = (string) get_option( 'now_shipping_installation_token', '' );
		$sec  = (string) get_option( 'now_shipping_shared_secret', '' );

		if ( ! $base || ! $tok || ! $sec ) {
			return array( 'ok' => false, 'code' => 0, 'data' => null, 'error' => 'not_configured' );
		}

		$raw  = wp_json_encode( $body );
		$ts   = (string) (int) round( microtime( true ) * 1000 );
		$sig  = hash_hmac( 'sha256', $raw, $sec );
		$url  = $base . $path;

		$res = wp_remote_post(
			$url,
			array(
				'timeout' => 30,
				'headers' => array(
					'Content-Type'      => 'application/json; charset=utf-8',
					'Accept'            => 'application/json',
					'Authorization'     => 'Bearer ' . $tok,
					'X-Now-Signature'   => $sig,
					'X-Now-Timestamp'   => $ts,
				),
				'body'    => $raw,
			)
		);

		if ( is_wp_error( $res ) ) {
			return array( 'ok' => false, 'code' => 0, 'data' => null, 'error' => $res->get_error_message() );
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$txt  = (string) wp_remote_retrieve_body( $res );
		$data = null;
		if ( $txt !== '' ) {
			$data = json_decode( $txt, true );
		}

		return array(
			'ok'   => $code >= 200 && $code < 300,
			'code' => $code,
			'data' => $data,
			'error'=> ( is_array( $data ) && isset( $data['error'] ) ) ? (string) $data['error'] : '',
		);
	}

	/**
	 * GET JSON (HMAC over empty string for GET — still send timestamp; signature over "").
	 *
	 * @param string $path With query string if needed.
	 */
	public static function get( $path ) {
		$base = rtrim( (string) get_option( 'now_shipping_api_base', '' ), '/' );
		$tok  = (string) get_option( 'now_shipping_installation_token', '' );
		$sec  = (string) get_option( 'now_shipping_shared_secret', '' );

		if ( ! $base || ! $tok || ! $sec ) {
			return array( 'ok' => false, 'code' => 0, 'data' => null, 'error' => 'not_configured' );
		}

		$raw = '';
		$ts  = (string) (int) round( microtime( true ) * 1000 );
		$sig = hash_hmac( 'sha256', $raw, $sec );
		$url = $base . $path;

		$res = wp_remote_get(
			$url,
			array(
				'timeout' => 30,
				'headers' => array(
					'Accept'          => 'application/json',
					'Authorization'   => 'Bearer ' . $tok,
					'X-Now-Signature' => $sig,
					'X-Now-Timestamp' => $ts,
				),
			)
		);

		if ( is_wp_error( $res ) ) {
			return array( 'ok' => false, 'code' => 0, 'data' => null, 'error' => $res->get_error_message() );
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$txt  = (string) wp_remote_retrieve_body( $res );
		$data = $txt !== '' ? json_decode( $txt, true ) : null;

		return array(
			'ok'   => $code >= 200 && $code < 300,
			'code' => $code,
			'data' => $data,
			'error'=> ( is_array( $data ) && isset( $data['error'] ) ) ? (string) $data['error'] : '',
		);
	}
}
