import { loadFailsafeConfig } from '../config.js';
import { runFailsafe } from './failsafe.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  runFailsafe(loadFailsafeConfig(process.env)).catch(() => {
    process.exitCode = 1;
  });
}
