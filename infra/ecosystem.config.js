module.exports = {
  apps: [
    {
      name:         'launchpad-server',
      script:       './server/server.js',
      cwd:          '/var/launchpad',
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT:     5000,
      },
      error_file:  '/var/launchpad/logs/server-error.log',
      out_file:    '/var/launchpad/logs/server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};