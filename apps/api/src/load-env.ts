import { loadEnvFile } from 'node:process';
import path from 'node:path';

try {
  loadEnvFile(path.resolve(__dirname, '../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

if (
  process.env.PRECOMMUNITY_NETWORK === 'base-sepolia' &&
  process.env.DATABASE_URL_TESTNET?.trim()
) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TESTNET.trim();
}
