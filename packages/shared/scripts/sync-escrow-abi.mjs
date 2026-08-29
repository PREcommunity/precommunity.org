import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL(
  '../../../../escrow/artifacts/contracts/PREcommunityEscrowV1.sol/PREcommunityEscrowV1.json',
  import.meta.url,
);
const pinnedArtifactUrl = new URL('../abi/PREcommunityEscrowV1.json', import.meta.url);
const generatedAbiUrl = new URL('../src/precommunity-escrow-abi.ts', import.meta.url);

const sourcePath = fileURLToPath(sourceUrl);
const artifact = JSON.parse(readFileSync(sourcePath, 'utf8'));

if (!Array.isArray(artifact.abi)) {
  throw new Error(`Escrow artifact at ${sourcePath} does not contain an ABI`);
}

copyFileSync(sourceUrl, pinnedArtifactUrl);
writeFileSync(
  generatedAbiUrl,
  [
    '// Generated from ../escrow. Run packages/shared/scripts/sync-escrow-abi.mjs to refresh.',
    `export const PRECOMMUNITY_ESCROW_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;`,
    '',
  ].join('\n'),
);
