import { z } from 'zod';
import { resolveServerConfig, serverConfigSchema } from '@precommunity/shared/server-config';

const developmentSessionSecret = 'development-only-session-secret-change-me';
const exampleSessionSecret = 'replace-with-at-least-32-random-characters';
const developmentAdsReportSecret = 'development-only-ads-report-secret';
const exampleAdsReportSecret = 'replace-with-an-independent-ads-report-secret';
const runtimeConfig = serverConfigSchema
  .safeExtend({
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3011'),
    SIWE_DOMAIN: z.string().default('localhost:3011'),
    SIWE_URI: z.string().url().default('http://localhost:3011'),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    ADS_REPORT_FINGERPRINT_SECRET: z.string().min(32).default(developmentAdsReportSecret),
    COMMUNITY_MIN_PRE: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .default('1'),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      (value.SESSION_SECRET === developmentSessionSecret ||
        value.SESSION_SECRET === exampleSessionSecret)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Production requires an explicit session secret',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      (value.ADS_REPORT_FINGERPRINT_SECRET === developmentAdsReportSecret ||
        value.ADS_REPORT_FINGERPRINT_SECRET === exampleAdsReportSecret)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADS_REPORT_FINGERPRINT_SECRET'],
        message: 'Production requires an independent PRE Keyword Market report fingerprint secret',
      });
    }
  })
  .parse(process.env);

const resolved = resolveServerConfig(runtimeConfig);

export const config = {
  ...resolved,
  BASE_CHAIN_ID: resolved.deployment.chainId,
  allowedWebOrigins: [new URL(runtimeConfig.WEB_ORIGIN).origin],
} as const;
