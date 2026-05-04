/**
 * Example PM2 ecosystem file.
 * Usage: pm2 start deploy/pm2.ecosystem.example.cjs --env production
 *
 * Prefer loading secrets from a server-side env file (not committed):
 *   pm2 start ... --env production
 * and set `env_file` via deploy hook or use `pm2 ecosystem` with `env_production` filled on the VPS.
 */

module.exports = {
  apps: [
    {
      name: 'now-shipping',
      script: 'app.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        // PORT: '6098',
        // DATABASE_URL: 'mongodb://127.0.0.1:27017/nowShipping',
        // APP_URL: 'https://now.com.eg',
        // SHOPIFY_API_KEY: '',
        // SHOPIFY_API_SECRET: '',
        // SHOPIFY_SCOPES: 'read_customers,read_fulfillments,write_fulfillments,read_orders,write_orders',
        // SHOPIFY_API_VERSION: '2026-04',
        // SHOPIFY_TOKEN_ENCRYPTION_KEY: '',
        // SESSION_SECRET: '',
        // JWT_SECRET: '',
      },
    },
  ],
};
