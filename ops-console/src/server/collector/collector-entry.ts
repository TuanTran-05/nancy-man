import { startCollector } from './collector-main.js';

startCollector().catch(() => { process.exitCode = 1; });
