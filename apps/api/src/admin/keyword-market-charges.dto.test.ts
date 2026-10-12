import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AdChargeHistoryQueryDto, UpdateAdChargeSettingsDto } from './keyword-market-charges.dto';

describe('charge settings validation', () => {
  const settings = { automaticEnabled: false, intervalMinutes: 10, clickThreshold: 50 };

  it('accepts disabled automatic charging with positive integer triggers', async () => {
    expect(await validate(plainToInstance(UpdateAdChargeSettingsDto, settings))).toEqual([]);
  });

  it.each(['intervalMinutes', 'clickThreshold'] as const)(
    'rejects unsafe %s values',
    async (field) => {
      for (const value of [0, -1, 1.5, '10', 2_147_483_648, undefined]) {
        const errors = await validate(
          plainToInstance(UpdateAdChargeSettingsDto, { ...settings, [field]: value }),
        );
        expect(errors.map((error) => error.property)).toContain(field);
      }
    },
  );

  it('requires an explicit boolean and validates a provided history cursor', async () => {
    expect(
      await validate(
        plainToInstance(UpdateAdChargeSettingsDto, { ...settings, automaticEnabled: 'false' }),
      ),
    ).not.toHaveLength(0);
    expect(await validate(plainToInstance(AdChargeHistoryQueryDto, {}))).toEqual([]);
    expect(
      await validate(plainToInstance(AdChargeHistoryQueryDto, { cursor: 'bad' })),
    ).not.toHaveLength(0);
  });

  it('rejects extra settings/query fields through the application validation boundary', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        { ...settings, contractAddress: 'another-contract' },
        {
          type: 'body',
          metatype: UpdateAdChargeSettingsDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { cursor: ['bad', 'worse'] },
        {
          type: 'query',
          metatype: AdChargeHistoryQueryDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { password: 'not-accepted-here' },
        {
          type: 'query',
          metatype: AdChargeHistoryQueryDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
