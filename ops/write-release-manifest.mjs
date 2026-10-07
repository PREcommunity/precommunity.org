import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function repositoryIdentity(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const revision = git('rev-parse', 'HEAD').trim();
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .split('\0')
    .filter((file) => file && !/^(?:\.aws|\.codex|\.agents|\.env|\.keystore)(?:[./-]|$)/.test(file))
    .sort();
  const source = createHash('sha256');
  for (const file of [...new Set(files)]) {
    source.update(file).update('\0');
    try {
      source.update(readFileSync(path.join(root, file)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      source.update('<deleted>');
    }
    source.update('\0');
  }
  return {
    revision,
    dirty: git('status', '--porcelain').trim() !== '',
    sourceSha256: source.digest('hex'),
  };
}

export function artifactIdentity(bytes) {
  const artifact = JSON.parse(bytes);
  if (!Array.isArray(artifact.abi) || !artifact.buildInfoId || !artifact.deployedBytecode) {
    throw new Error('The reviewed Keyword Market artifact is incomplete.');
  }
  return {
    abiSha256: sha256(JSON.stringify(artifact.abi)),
    artifactSha256: sha256(bytes),
    buildInfoId: artifact.buildInfoId,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node ops/write-release-manifest.mjs <output-file>');
  const escrowRoot = path.resolve(appRoot, '../escrow');
  const artifactBytes = readFileSync(
    path.join(appRoot, 'packages/shared/abi/PREKeywordMarketV1.json'),
  );
  const manifest = {
    schema: 'precommunity.release.v1',
    createdAt: new Date().toISOString(),
    application: repositoryIdentity(appRoot),
    escrow: repositoryIdentity(escrowRoot),
    keywordMarket: artifactIdentity(artifactBytes),
  };
  writeFileSync(process.argv[2], `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}
