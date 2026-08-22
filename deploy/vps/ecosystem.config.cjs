module.exports = {
  apps: [
    {
      name: 'edutrack',
      cwd: '/srv/edutrack/current',
      script: 'dist-server/index.js',
      node_args: '--env-file=/srv/edutrack/shared/.env --enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1500M',
      out_file: '/srv/edutrack/shared/logs/app-out.log',
      error_file: '/srv/edutrack/shared/logs/app-error.log',
      time: true,
      kill_timeout: 15000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3000',
      },
    },
  ],
};
