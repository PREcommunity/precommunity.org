import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const contracts = [
  {
    name: 'PREcommunityEscrowV1',
    source:
      '../../../../escrow/artifacts/contracts/PREcommunityEscrowV1.sol/PREcommunityEscrowV1.json',
    pinned: '../abi/PREcommunityEscrowV1.json',
    generated: '../src/precommunity-escrow-abi.ts',
    exportName: 'PRECOMMUNITY_ESCROW_ABI',
  },
  {
    name: 'PREKeywordMarketV1',
    source: '../../../../escrow/artifacts/contracts/PREKeywordMarketV1.sol/PREKeywordMarketV1.json',
    pinned: '../abi/PREKeywordMarketV1.json',
    generated: '../src/pre-keyword-market-abi.ts',
    exportName: 'PRE_KEYWORD_MARKET_ABI',
  },
];

const selectedName = process.argv.find((arg) => arg.startsWith('--contract='))?.split('=')[1];
if (selectedName && !contracts.some((contract) => contract.name === selectedName)) {
  throw new Error(`Unknown ABI contract: ${selectedName}`);
}
for (const contract of contracts.filter((item) => !selectedName || item.name === selectedName)) {
  const sourceUrl = new URL(contract.source, import.meta.url);
  const sourcePath = fileURLToPath(sourceUrl);
  const artifact = JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`${contract.name} artifact at ${sourcePath} does not contain an ABI`);
  }
  copyFileSync(sourceUrl, new URL(contract.pinned, import.meta.url));
  writeFileSync(
    new URL(contract.generated, import.meta.url),
    [
      '// Generated from ../escrow. Run packages/shared/scripts/sync-escrow-abi.mjs to refresh.',
      `export const ${contract.exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;`,
      '',
    ].join('\n'),
  );
}
