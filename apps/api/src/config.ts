import { z } from 'zod';
import { resolveServerConfig, serverConfigSchema } from '@precommunity/shared/server-config';

const developmentSessionSecret = 'development-only-session-secret-change-me';
const exampleSessionSecret = 'replace-with-at-least-32-random-characters';
const developmentAdsReportSecret = 'development-only-ads-report-secret';
const exampleAdsReportSecret = 'replace-with-an-independent-ads-report-secret';
const developmentAdsDeliverySecret = 'development-only-ads-delivery-secret';
const exampleAdsDeliverySecret = 'replace-with-an-independent-ads-delivery-secret';
const developmentAdsClickSecret = 'development-only-ads-click-fingerprint-secret';
const exampleAdsClickSecret = 'replace-with-an-independent-ads-click-fingerprint-secret';
const runtimeConfig = serverConfigSchema
  .safeExtend({
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3011'),
    SIWE_DOMAIN: z.string().default('localhost:3011'),
    SIWE_URI: z.string().url().default('http://localhost:3011'),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    ADS_REPORT_FINGERPRINT_SECRET: z.string().min(32).default(developmentAdsReportSecret),
    ADS_DELIVERY_SECRET: z.string().min(32).default(developmentAdsDeliverySecret),
    ADS_CLICK_FINGERPRINT_SECRET: z.string().min(32).default(developmentAdsClickSecret),
    COMMUNITY_MIN_PRE: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .default('1'),
  })
  .superRefine((value, context) => {
    const secrets = [
      [
        'SESSION_SECRET',
        developmentSessionSecret,
        exampleSessionSecret,
        'an explicit session secret',
      ],
      [
        'ADS_REPORT_FINGERPRINT_SECRET',
        developmentAdsReportSecret,
        exampleAdsReportSecret,
        'an independent PRE Keyword Market report fingerprint secret',
      ],
      [
        'ADS_DELIVERY_SECRET',
        developmentAdsDeliverySecret,
        exampleAdsDeliverySecret,
        'an independent PRE Keyword Market delivery secret',
      ],
      [
        'ADS_CLICK_FINGERPRINT_SECRET',
        developmentAdsClickSecret,
        exampleAdsClickSecret,
        'an independent PRE Keyword Market click fingerprint secret',
      ],
    ] as const;
    for (const [index, [name, , , label]] of secrets.entries()) {
      if (
        value.NODE_ENV === 'production' &&
        secrets.some(
          ([, development, example]) => value[name] === development || value[name] === example,
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `Production requires ${label}`,
        });
      }
      if (secrets.slice(0, index).some(([previous]) => value[name] === value[previous])) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} must be independent from the other API secrets`,
        });
      }
    }
  })
  .parse(process.env);

const resolved = resolveServerConfig(runtimeConfig);

export const config = {
  ...resolved,
  BASE_CHAIN_ID: resolved.deployment.chainId,
  allowedWebOrigins: [new URL(runtimeConfig.WEB_ORIGIN).origin],
} as const;
