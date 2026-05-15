<?php
/**
 * Uninstall — remove options and notify Now (best-effort).
 *
 * @package NowShippingWoo
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$base = get_option( 'now_shipping_api_base', '' );
$tok  = get_option( 'now_shipping_installation_token', '' );
$sec  = get_option( 'now_shipping_shared_secret', '' );
$site = home_url( '/' );

if ( $base && $tok && $sec ) {
	$body = wp_json_encode( array( 'storeUrl' => $site ) );
	$ts   = (string) (int) round( microtime( true ) * 1000 );
	$sig  = hash_hmac( 'sha256', $body, $sec );
	wp_remote_post(
		rtrim( $base, '/' ) . '/api/woocommerce/webhooks',
		array(
			'timeout'  => 8,
			'headers'  => array(
				'Content-Type'    => 'application/json',
				'X-Now-Topic'     => 'app/uninstalled',
				'X-Now-Signature' => $sig,
				'X-Now-Timestamp' => $ts,
			),
			'body'     => $body,
			'blocking' => false,
		)
	);
}

$opts = array(
	'now_shipping_api_base',
	'now_shipping_installation_token',
	'now_shipping_shared_secret',
	'now_shipping_rest_ck',
	'now_shipping_rest_cs',
	'now_shipping_default_government',
	'now_shipping_default_zone',
);

foreach ( $opts as $k ) {
	delete_option( $k );
}
