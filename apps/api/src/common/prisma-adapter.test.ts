import { createPrismaAdapter } from '@precommunity/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function databaseUrl(schema?: string, options?: string) {
  const url = new URL('postgresql://adapter-test:fixture@127.0.0.1:1/adapter-test');
  if (schema !== undefined) url.searchParams.set('schema', schema);
  if (options !== undefined) url.searchParams.set('options', options);
  return url;
}

// PostgreSQL startup options split on whitespace; backslash preserves the next character.
function startupArguments(options: string) {
  const args: string[] = [];
  let token = '';
  let escaped = false;
  for (const character of options) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === '\\') escaped = true;
    else if (/[ \t\r\n\f\v]/.test(character)) {
      if (token) args.push(token);
      token = '';
    } else token += character;
  }
  if (token) args.push(token);
  return args;
}

async function driverOptions(url: URL) {
  const adapter = await createPrismaAdapter(url.toString()).connect();
  const pool = adapter.underlyingDriver();
  // Use the installed pg Client from its real pool, without opening a connection.
  const Client = (
    pool as unknown as {
      Client: new (options: { connectionString: string }) => {
        connectionParameters: { options: string | undefined };
        end: () => Promise<void>;
      };
    }
  ).Client;
  const connectionString = pool.options.connectionString!;
  const client = new Client({ connectionString });
  try {
    expect(pool.totalCount).toBe(0);
    expect(new URL(connectionString).searchParams.has('schema')).toBe(false);
    return {
      options: client.connectionParameters.options,
      schema: adapter.getConnectionInfo().schemaName,
    };
  } finally {
    await client.end();
    await adapter.dispose();
  }
}

describe('PostgreSQL raw-query schema routing', () => {
  beforeEach(() => vi.stubEnv('PGOPTIONS', ''));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['MiXeD', 'search_path="MiXeD"'],
    ['with space', 'search_path="with space"'],
    ['with"quote', 'search_path="with""quote"'],
    ['with\\slash', 'search_path="with\\slash"'],
    ['schema" -c statement_timeout=1', 'search_path="schema"" -c statement_timeout=1"'],
    [
      'schema\t-c\napplication_name=injected',
      'search_path="schema\t-c\napplication_name=injected"',
    ],
  ])('keeps schema %j in one quoted startup setting', async (schema, expected) => {
    const result = await driverOptions(databaseUrl(schema));
    expect(result.schema).toBe(schema);
    expect(startupArguments(result.options!)).toEqual(['-c', expected]);
  });

  it('retains existing settings and overrides an earlier search path last', async () => {
    const result = await driverOptions(
      databaseUrl('billing', '-c statement_timeout=1234 -c search_path=public'),
    );
    expect(startupArguments(result.options!)).toEqual([
      '-c',
      'statement_timeout=1234',
      '-c',
      'search_path=public',
      '-c',
      'search_path="billing"',
    ]);
  });

  it('uses the last duplicate options value, matching the pg connection parser', async () => {
    const url = databaseUrl('billing', '-c statement_timeout=1');
    url.searchParams.append('options', '-c application_name=preserved');
    const result = await driverOptions(url);
    expect(startupArguments(result.options!)).toEqual([
      '-c',
      'application_name=preserved',
      '-c',
      'search_path="billing"',
    ]);
  });

  it('leaves supplied options unchanged when no schema is selected', async () => {
    const options = '-c application_name=unchanged -c statement_timeout=4567';
    const result = await driverOptions(databaseUrl(undefined, options));
    expect(result.options).toBe(options);
    expect(result.schema).toBeUndefined();
  });

  it('rejects NUL schema names and dangling option escapes before constructing a pool', () => {
    expect(() => createPrismaAdapter(databaseUrl('bad\0schema').toString())).toThrow(
      'Invalid database schema',
    );
    for (const suffix of ['\\', '\\\\\\']) {
      expect(() =>
        createPrismaAdapter(databaseUrl('billing', `-c application_name=name${suffix}`).toString()),
      ).toThrow('Invalid database connection options');
    }
  });

  it('preserves an escaped literal backslash at the end of existing options', async () => {
    const result = await driverOptions(databaseUrl('billing', '-c application_name=name\\\\'));
    expect(startupArguments(result.options!)).toEqual([
      '-c',
      'application_name=name\\',
      '-c',
      'search_path="billing"',
    ]);
  });
});
