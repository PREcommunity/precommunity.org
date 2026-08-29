import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearGeneratedCacheGroup, generatedCachePaths } from './generated-cache.mjs';

let testRoot;

afterEach(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = undefined;
});

describe('generated cache cleanup', () => {
  it('removes only the selected cache group', async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), 'precommunity-cache-test-'));
    const paths = generatedCachePaths(testRoot);
    const sentinel = path.join(testRoot, 'source-file.txt');
    await mkdir(paths.development[0], { recursive: true });
    await mkdir(paths.e2e[0], { recursive: true });
    await writeFile(path.join(paths.development[0], 'cache.sst'), 'generated');
    await writeFile(path.join(paths.e2e[0], 'cache.sst'), 'generated');
    await writeFile(sentinel, 'preserve');

    await clearGeneratedCacheGroup('development', { webDirectory: testRoot });

    await expect(access(paths.development[0])).rejects.toThrow();
    await expect(access(paths.e2e[0])).resolves.toBeUndefined();
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserve');
  });

  it('rejects an unknown cleanup group', async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), 'precommunity-cache-test-'));
    await expect(clearGeneratedCacheGroup('workspace', { webDirectory: testRoot })).rejects.toThrow(
      'Unknown generated cache group',
    );
  });
});
