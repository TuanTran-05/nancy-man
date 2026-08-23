import { loadFailsafeConfig } from '../config.js';
import { runFailsafe } from './failsafe.js';

runFailsafe(loadFailsafeConfig(process.env)).catch(() => { process.exitCode = 1; });
