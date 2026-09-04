import { resolveServerConfig, serverConfigSchema } from '@precommunity/shared/server-config';

export const config = resolveServerConfig(serverConfigSchema.parse(process.env));
