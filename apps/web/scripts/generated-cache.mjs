import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultWebDirectory = fileURLToPath(new URL('..', import.meta.url));

export function generatedCachePaths(webDirectory = defaultWebDirectory) {
  const root = path.resolve(webDirectory);
  return {
    development: [path.join(root, '.next', 'dev', 'cache')],
    build: [path.join(root, '.next', 'cache')],
    e2e: [path.join(root, '.next-e2e', 'dev', 'cache'), path.join(root, '.next-e2e', 'cache')],
  };
}

export async function clearGeneratedCacheGroup(group, options = {}) {
  const webDirectory = options.webDirectory ?? defaultWebDirectory;
  const groups = generatedCachePaths(webDirectory);
  const selected =
    group === 'all' ? [...groups.development, ...groups.build, ...groups.e2e] : groups[group];

  if (!selected) throw new Error(`Unknown generated cache group: ${group}`);

  const allowed = new Set(
    Object.values(groups)
      .flat()
      .map((target) => path.resolve(target)),
  );
  for (const target of selected) {
    const resolvedTarget = path.resolve(target);
    if (!allowed.has(resolvedTarget)) {
      throw new Error(`Refusing to clean an unexpected path: ${resolvedTarget}`);
    }
    await rm(resolvedTarget, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
