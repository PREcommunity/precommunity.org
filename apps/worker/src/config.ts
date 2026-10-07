import { resolveServerConfig, serverConfigSchema } from '@precommunity/shared/server-config';

export const config = resolveServerConfig(serverConfigSchema.parse(process.env));

// The public Base RPC limits eth_getLogs requests to 500 inclusive blocks.
export const INDEXER_LOG_BLOCK_RANGE = 500n;
