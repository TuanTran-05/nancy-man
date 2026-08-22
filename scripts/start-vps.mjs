process.env.NODE_ENV = 'production';

const { startServer } = await import('../dist-server/index.js');

startServer();
