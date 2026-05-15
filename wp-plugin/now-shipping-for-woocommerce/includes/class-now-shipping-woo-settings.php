<?php
/**
 * Settings UI under WooCommerce menu.
 *
 * @package NowShippingWoo
 */

defined( 'ABSPATH' ) || exit;

final class Now_Shipping_Woo_Settings {

	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		add_action( 'admin_menu', array( $this, 'register_menu' ), 99 );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	public function register_menu() {
		add_submenu_page(
			'woocommerce',
			__( 'Now Shipping', 'now-shipping-for-woocommerce' ),
			__( 'Now Shipping', 'now-shipping-for-woocommerce' ),
			'manage_woocommerce',
			'now-shipping-woo',
			array( $this, 'render_page' )
		);
	}

	public function register_settings() {
		register_setting(
			'now_shipping_woo',
			'now_shipping_api_base',
			array(
				'type'              => 'string',
				'sanitize_callback' => array( $this, 'sanitize_url' ),
			)
		);
		register_setting(
			'now_shipping_woo',
			'now_shipping_default_government',
			array( 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' )
		);
		register_setting(
			'now_shipping_woo',
			'now_shipping_default_zone',
			array( 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' )
		);
		foreach ( array( 'now_shipping_installation_token', 'now_shipping_shared_secret', 'now_shipping_rest_ck', 'now_shipping_rest_cs' ) as $opt ) {
			register_setting(
				'now_shipping_woo',
				$opt,
				array(
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				)
			);
		}
	}

	public function sanitize_url( $v ) {
		$v = esc_url_raw( trim( (string) $v ) );
		return rtrim( $v, '/' );
	}

	public function enqueue( $hook ) {
		if ( strpos( (string) $hook, 'now-shipping-woo' ) === false ) {
			return;
		}
		wp_enqueue_style( 'now-shipping-woo-admin', NOW_SHIPPING_WOO_URL . 'assets/admin.css', array(), NOW_SHIPPING_WOO_VERSION );
		wp_enqueue_script( 'now-shipping-woo-admin', NOW_SHIPPING_WOO_URL . 'assets/admin.js', array( 'jquery' ), NOW_SHIPPING_WOO_VERSION, true );
		wp_localize_script(
			'now-shipping-woo-admin',
			'NowShippingWoo',
			array(
				'restUrl' => rest_url( 'now-shipping/v1/' ),
				'nonce'   => wp_create_nonce( 'wp_rest' ),
			)
		);
	}

	public function render_page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$api_base = get_option( 'now_shipping_api_base', '' );
		if ( $api_base === '' ) {
			$api_base = NOW_SHIPPING_WOO_DEFAULT_ORIGIN;
		}

		if ( isset( $_POST['now_shipping_woo_save'] ) && check_admin_referer( 'now_shipping_woo_save', 'now_shipping_woo_nonce' ) ) {
			update_option( 'now_shipping_api_base', $this->sanitize_url( wp_unslash( $_POST['now_shipping_api_base'] ?? '' ) ) );
			update_option( 'now_shipping_installation_token', sanitize_text_field( wp_unslash( $_POST['now_shipping_installation_token'] ?? '' ) ) );
			update_option( 'now_shipping_shared_secret', sanitize_text_field( wp_unslash( $_POST['now_shipping_shared_secret'] ?? '' ) ) );
			update_option( 'now_shipping_rest_ck', sanitize_text_field( wp_unslash( $_POST['now_shipping_rest_ck'] ?? '' ) ) );
			update_option( 'now_shipping_rest_cs', sanitize_text_field( wp_unslash( $_POST['now_shipping_rest_cs'] ?? '' ) ) );
			update_option( 'now_shipping_default_government', sanitize_text_field( wp_unslash( $_POST['now_shipping_default_government'] ?? '' ) ) );
			update_option( 'now_shipping_default_zone', sanitize_text_field( wp_unslash( $_POST['now_shipping_default_zone'] ?? '' ) ) );
			echo '<div class="updated notice"><p>' . esc_html__( 'Settings saved.', 'now-shipping-for-woocommerce' ) . '</p></div>';
		}

		if ( isset( $_POST['now_shipping_woo_connect'] ) && check_admin_referer( 'now_shipping_woo_connect', 'now_shipping_woo_connect_nonce' ) ) {
			$this->handle_connect();
		}

		if ( isset( $_POST['now_shipping_woo_rest'] ) && check_admin_referer( 'now_shipping_woo_rest', 'now_shipping_woo_rest_nonce' ) ) {
			$this->handle_rest_register();
		}

		$api_base   = get_option( 'now_shipping_api_base', NOW_SHIPPING_WOO_DEFAULT_ORIGIN );
		$tok        = get_option( 'now_shipping_installation_token', '' );
		$sec        = get_option( 'now_shipping_shared_secret', '' );
		$rest_ck    = get_option( 'now_shipping_rest_ck', '' );
		$rest_cs    = get_option( 'now_shipping_rest_cs', '' );
		$def_gov    = get_option( 'now_shipping_default_government', '' );
		$def_zone   = get_option( 'now_shipping_default_zone', '' );

		?>
		<div class="wrap now-shipping-woo-wrap">
			<h1><?php echo esc_html__( 'Now Shipping', 'now-shipping-for-woocommerce' ); ?></h1>
			<p class="description">
				<?php echo esc_html__( 'Pair your store from Now → Business → Settings → Integrations → WooCommerce, then paste the installation token and shared secret returned after you click Connect below.', 'now-shipping-for-woocommerce' ); ?>
			</p>

			<h2><?php echo esc_html__( 'Connect with pairing code', 'now-shipping-for-woocommerce' ); ?></h2>
			<form method="post" class="now-s-card">
				<?php wp_nonce_field( 'now_shipping_woo_connect', 'now_shipping_woo_connect_nonce' ); ?>
				<table class="form-table">
					<tr>
						<th><label for="ns_api_base"><?php esc_html_e( 'Now API base', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="ns_api_base" id="ns_api_base" type="url" class="regular-text" value="<?php echo esc_attr( $api_base ); ?>" required /></td>
					</tr>
					<tr>
						<th><label for="ns_public_code"><?php esc_html_e( 'Public code', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="ns_public_code" id="ns_public_code" type="text" class="regular-text" required /></td>
					</tr>
					<tr>
						<th><label for="ns_pairing_secret"><?php esc_html_e( 'Pairing secret', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="ns_pairing_secret" id="ns_pairing_secret" type="password" class="regular-text" autocomplete="off" required /></td>
					</tr>
					<tr>
						<th><label for="ns_store_url"><?php esc_html_e( 'Store URL', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="ns_store_url" id="ns_store_url" type="url" class="regular-text" value="<?php echo esc_attr( home_url( '/' ) ); ?>" required /></td>
					</tr>
				</table>
				<?php submit_button( __( 'Connect to Now', 'now-shipping-for-woocommerce' ), 'primary', 'now_shipping_woo_connect' ); ?>
			</form>

			<hr />

			<h2><?php echo esc_html__( 'Manual credentials', 'now-shipping-for-woocommerce' ); ?></h2>
			<form method="post">
				<?php wp_nonce_field( 'now_shipping_woo_save', 'now_shipping_woo_nonce' ); ?>
				<table class="form-table">
					<tr>
						<th><label for="now_shipping_api_base"><?php esc_html_e( 'Now API base URL', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_api_base" id="now_shipping_api_base" type="url" class="regular-text" value="<?php echo esc_attr( $api_base ); ?>" /></td>
					</tr>
					<tr>
						<th><label for="now_shipping_installation_token"><?php esc_html_e( 'Installation token', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_installation_token" id="now_shipping_installation_token" type="password" class="large-text" value="<?php echo esc_attr( $tok ); ?>" autocomplete="off" /></td>
					</tr>
					<tr>
						<th><label for="now_shipping_shared_secret"><?php esc_html_e( 'Shared HMAC secret', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_shared_secret" id="now_shipping_shared_secret" type="password" class="large-text" value="<?php echo esc_attr( $sec ); ?>" autocomplete="off" /></td>
					</tr>
					<tr>
						<th><label for="now_shipping_rest_ck"><?php esc_html_e( 'WooCommerce REST consumer key', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_rest_ck" id="now_shipping_rest_ck" type="text" class="large-text" value="<?php echo esc_attr( $rest_ck ); ?>" autocomplete="off" /></td>
					</tr>
					<tr>
						<th><label for="now_shipping_rest_cs"><?php esc_html_e( 'WooCommerce REST consumer secret', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_rest_cs" id="now_shipping_rest_cs" type="password" class="large-text" value="<?php echo esc_attr( $rest_cs ); ?>" autocomplete="off" /></td>
					</tr>
					<tr>
						<th><label for="now_shipping_default_government"><?php esc_html_e( 'Default governorate (manual import)', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_default_government" id="now_shipping_default_government" type="text" class="regular-text" value="<?php echo esc_attr( $def_gov ); ?>" placeholder="e.g. cairo" /></td>
					</tr>
					<tr>
						<th><label for="now_shipping_default_zone"><?php esc_html_e( 'Default zone (manual import)', 'now-shipping-for-woocommerce' ); ?></label></th>
						<td><input name="now_shipping_default_zone" id="now_shipping_default_zone" type="text" class="regular-text" value="<?php echo esc_attr( $def_zone ); ?>" placeholder="Bosta area value" /></td>
					</tr>
				</table>
				<?php submit_button( __( 'Save settings', 'now-shipping-for-woocommerce' ), 'secondary', 'now_shipping_woo_save' ); ?>
			</form>

			<hr />

			<h2><?php esc_html_e( 'Push REST keys to Now (optional)', 'now-shipping-for-woocommerce' ); ?></h2>
			<p><?php esc_html_e( 'If you saved REST keys above, click to copy them to the Now server (encrypted) so the dashboard can list WooCommerce orders.', 'now-shipping-for-woocommerce' ); ?></p>
			<form method="post">
				<?php wp_nonce_field( 'now_shipping_woo_rest', 'now_shipping_woo_rest_nonce' ); ?>
				<?php submit_button( __( 'Register REST keys on Now', 'now-shipping-for-woocommerce' ), 'secondary', 'now_shipping_woo_rest' ); ?>
			</form>

			<hr />
			<h2><?php esc_html_e( 'Sync logs', 'now-shipping-for-woocommerce' ); ?></h2>
			<div id="now-shipping-sync-logs"><?php $this->render_sync_logs(); ?></div>
		</div>
		<?php
	}

	private function handle_connect() {
		$public = sanitize_text_field( wp_unslash( $_POST['ns_public_code'] ?? '' ) );
		$secret = (string) wp_unslash( $_POST['ns_pairing_secret'] ?? '' );
		$store  = esc_url_raw( trim( (string) wp_unslash( $_POST['ns_store_url'] ?? '' ) ) );
		$base   = rtrim( (string) wp_unslash( $_POST['ns_api_base'] ?? get_option( 'now_shipping_api_base', NOW_SHIPPING_WOO_DEFAULT_ORIGIN ) ), '/' );

		$res = wp_remote_post(
			$base . '/api/woocommerce/connect',
			array(
				'timeout' => 25,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'publicCode'  => $public,
						'secret'      => $secret,
						'storeUrl'    => $store,
						'wcVersion'   => defined( 'WC_VERSION' ) ? WC_VERSION : '',
						'phpVersion'  => PHP_VERSION,
					)
				),
			)
		);

		if ( is_wp_error( $res ) ) {
			echo '<div class="error notice"><p>' . esc_html( $res->get_error_message() ) . '</p></div>';
			return;
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
		if ( $code < 200 || $code >= 300 || empty( $data['installationToken'] ) || empty( $data['sharedSecret'] ) ) {
			$err = is_array( $data ) && isset( $data['error'] ) ? (string) $data['error'] : 'connect_failed';
			echo '<div class="error notice"><p>' . esc_html( $err ) . '</p></div>';
			return;
		}

		update_option( 'now_shipping_api_base', rtrim( (string) ( $data['apiBaseUrl'] ?? $base ), '/' ) );
		update_option( 'now_shipping_installation_token', (string) $data['installationToken'] );
		update_option( 'now_shipping_shared_secret', (string) $data['sharedSecret'] );
		echo '<div class="updated notice"><p>' . esc_html__( 'Connected to Now Shipping.', 'now-shipping-for-woocommerce' ) . '</p></div>';
	}

	private function handle_rest_register() {
		$ck = get_option( 'now_shipping_rest_ck', '' );
		$cs = get_option( 'now_shipping_rest_cs', '' );
		if ( ! $ck || ! $cs ) {
			echo '<div class="error notice"><p>' . esc_html__( 'Save REST consumer key and secret first.', 'now-shipping-for-woocommerce' ) . '</p></div>';
			return;
		}
		$r = Now_Shipping_Woo_Api::request(
			'/api/woocommerce/app/rest-credentials',
			array(
				'consumer_key'    => $ck,
				'consumer_secret' => $cs,
			)
		);
		if ( ! $r['ok'] ) {
			echo '<div class="error notice"><p>' . esc_html( $r['error'] ?: 'request_failed' ) . '</p></div>';
			return;
		}
		echo '<div class="updated notice"><p>' . esc_html__( 'REST keys registered on Now.', 'now-shipping-for-woocommerce' ) . '</p></div>';
	}

	private function render_sync_logs() {
		$r = Now_Shipping_Woo_Api::get( '/api/woocommerce/app/sync-logs?limit=20' );
		if ( ! $r['ok'] || ! is_array( $r['data'] ) || empty( $r['data']['logs'] ) ) {
			echo '<p>' . esc_html__( 'No logs or not connected.', 'now-shipping-for-woocommerce' ) . '</p>';
			return;
		}
		echo '<table class="widefat striped"><thead><tr><th>Time</th><th>WC order</th><th>Topic</th><th>Status</th><th>Reason</th><th>Now #</th></tr></thead><tbody>';
		foreach ( $r['data']['logs'] as $row ) {
			echo '<tr>';
			echo '<td>' . esc_html( isset( $row['createdAt'] ) ? (string) $row['createdAt'] : '' ) . '</td>';
			echo '<td>' . esc_html( (string) ( $row['wcOrderNumber'] ?? $row['wcOrderId'] ?? '' ) ) . '</td>';
			echo '<td>' . esc_html( (string) ( $row['topic'] ?? '' ) ) . '</td>';
			echo '<td>' . esc_html( (string) ( $row['status'] ?? '' ) ) . '</td>';
			echo '<td>' . esc_html( (string) ( $row['reason'] ?? '' ) ) . '</td>';
			echo '<td>' . esc_html( (string) ( $row['nowOrderNumber'] ?? '' ) ) . '</td>';
			echo '</tr>';
		}
		echo '</tbody></table>';
	}
}
