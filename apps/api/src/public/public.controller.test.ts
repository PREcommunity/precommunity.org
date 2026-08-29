import { describe, expect, it, vi } from 'vitest';
import { PublicController } from './public.controller';
import type { PublicService } from './public.service';

describe('monthly public reports', () => {
  it('includes period policy, carry and vested values in CSV rows', async () => {
    const report = {
      months: [
        {
          month: '2028-02',
          goals: [
            {
              title: 'Monthly public nodes',
              subproject: { name: 'Infrastructure' },
              category: 'Nodes',
              goalType: 'MONTHLY',
              status: 'OPEN',
              creationTxHash: `0x${'11'.repeat(32)}`,
              progress: [
                {
                  asset: 'PRE',
                  target: '100',
                  funded: '120',
                  released: '100',
                  surplus: '20',
                },
              ],
              monthly: {
                firstSettlementAt: '2028-02-01T00:00:00.000Z',
                settlementDay: 1,
                selectedPeriod: {
                  periodIndex: 2,
                  startsAt: '2028-02-01T00:00:00.000Z',
                  endsAt: '2028-03-01T00:00:00.000Z',
                  surplusPolicy: 'ROLL_OVER',
                  assets: [{ asset: 'PRE', carryIn: '20', vested: '100', carryOut: '20' }],
                },
              },
            },
          ],
        },
      ],
    };
    const service = { report: vi.fn().mockResolvedValue(report) } as unknown as PublicService;
    const setHeader = vi.fn();
    const response = { type: vi.fn().mockReturnValue({ setHeader }) };

    const csv = await new PublicController(service).report(
      '2028-02',
      undefined,
      undefined,
      undefined,
      'csv',
      response as never,
    );

    expect(csv).toContain(
      'goal_type,period_index,period_start,period_end,policy,first_settlement_at,settlement_day,asset,target,funded,released,surplus,carry_in,vested,carry_out',
    );
    expect(csv).toContain(
      '"MONTHLY","2","2028-02-01T00:00:00.000Z","2028-03-01T00:00:00.000Z","ROLL_OVER","2028-02-01T00:00:00.000Z","1","PRE","100","120","100","20","20","100","20"',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="precommunity-2028-02.csv"',
    );
  });
});
