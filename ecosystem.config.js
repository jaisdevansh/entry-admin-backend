/**
 * PM2 Ecosystem Configuration - Admin API
 * Production-ready clustering for maximum performance
 * 
 * Usage:
 * - Development: pm2 start ecosystem.config.js --env development
 * - Production: pm2 start ecosystem.config.js --env production
 * - Monitor: pm2 monit
 * - Logs: pm2 logs admin-api
 */

module.exports = {
  apps: [
    {
      name: 'admin-api',
      script: './server.js',
      instances: 'max', // Use all available CPU cores
      exec_mode: 'cluster', // Enable clustering
      watch: false, // Disable in production
      max_memory_restart: '500M', // Restart if memory exceeds 500MB
      env: {
        NODE_ENV: 'development',
        PORT: 3002
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3002
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 10000,
      kill_timeout: 5000,
      // Graceful shutdown
      wait_ready: true,
      // Health check
      health_check: {
        url: 'http://localhost:3002/health',
        interval: 30000, // 30 seconds
        timeout: 5000
      }
    }
  ]
};
