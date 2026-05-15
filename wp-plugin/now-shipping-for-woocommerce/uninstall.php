<?php
/**
 * Uninstall — remove options and notify Now (best-effort).
 *
 * @package NowShippingWoo
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$now_shipping_base = get_option( 'now_shipping_api_base', '' );
$now_shipping_tok  = get_option( 'now_shipping_installation_token', '' );
$now_shipping_sec  = get_option( 'now_shipping_shared_secret', '' );
$now_shipping_site = home_url( '/' );

if ( $now_shipping_base && $now_shipping_tok && $now_shipping_sec ) {
	$now_shipping_body = wp_json_encode( array( 'storeUrl' => $now_shipping_site ) );
	$now_shipping_ts   = (string) (int) round( microtime( true ) * 1000 );
	$now_shipping_sig  = hash_hmac( 'sha256', $now_shipping_body, $now_shipping_sec );
	wp_remote_post(
		rtrim( $now_shipping_base, '/' ) . '/api/woocommerce/webhooks',
		array(
			'timeout'  => 8,
			'headers'  => array(
				'Content-Type'    => 'application/json',
				'X-Now-Topic'     => 'app/uninstalled',
				'X-Now-Signature' => $now_shipping_sig,
				'X-Now-Timestamp' => $now_shipping_ts,
			),
			'body'     => $now_shipping_body,
			'blocking' => false,
		)
	);
}

$now_shipping_opts = array(
	'now_shipping_api_base',
	'now_shipping_installation_token',
	'now_shipping_shared_secret',
	'now_shipping_rest_ck',
	'now_shipping_rest_cs',
	'now_shipping_default_government',
	'now_shipping_default_zone',
);

foreach ( $now_shipping_opts as $now_shipping_k ) {
	delete_option( $now_shipping_k );
}
