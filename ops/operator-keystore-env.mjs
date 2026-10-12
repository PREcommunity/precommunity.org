import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export function operatorKeystorePair(env, suffix = '', prefix = 'ADS_OPERATOR') {
  const keystorePath = env[`${prefix}_KEYSTORE_PATH${suffix}`]?.trim() || '';
  const rawPassword = env[`${prefix}_KEYSTORE_PASSWORD${suffix}`];
  const encoded = env[`${prefix}_KEYSTORE_PASSWORD_BASE64${suffix}`] || '';
  let password = rawPassword === '' || rawPassword === undefined ? '' : rawPassword;
  if (!password && encoded) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('The operator password encoding is invalid.');
    }
    const decoded = Buffer.from(encoded, 'base64');
    password = decoded.toString('utf8');
    if (Buffer.from(password).toString('base64') !== encoded) {
      throw new Error('The operator password encoding is invalid.');
    }
  }
  if (Boolean(keystorePath) !== Boolean(password)) {
    throw new Error('Configure the operator keystore path and password together.');
  }
  if (password.includes('\0')) throw new Error('The operator password contains unsupported bytes.');
  return keystorePath ? { path: keystorePath, password } : null;
}

export function encodedOperatorPair(pair, suffix = '', prefix = 'ADS_OPERATOR') {
  return {
    [`${prefix}_KEYSTORE_PATH${suffix}`]: pair?.path ?? '',
    [`${prefix}_KEYSTORE_PASSWORD${suffix}`]: '',
    [`${prefix}_KEYSTORE_PASSWORD_BASE64${suffix}`]: pair
      ? Buffer.from(pair.password).toString('base64')
      : '',
  };
}

export function serializeNativeEnv(env) {
  return (
    Object.entries(env)
      .map(([key, value]) => {
        for (const candidate of [`'${value}'`, `"${value}"`, `\`${value}\``, value]) {
          if (parseEnv(`VALUE=${candidate}`).VALUE === value) return `${key}=${candidate}`;
        }
        throw new Error('An environment value cannot be serialized without changing it.');
      })
      .join('\n') + '\n'
  );
}

function shellSafeValue(value) {
  if (!/[\r\n']/.test(value)) return `'${value}'`;
  if (!/[\r\n"\\$`]/.test(value)) return `"${value}"`;
  throw new Error(
    'The operator keystore path cannot be represented safely in the runtime environment.',
  );
}

export function operatorPayload(env, network, prefix = 'ADS_OPERATOR') {
  if (!['base', 'base-sepolia'].includes(network)) throw new Error('Invalid operator network.');
  const pair = operatorKeystorePair(env, network === 'base-sepolia' ? '_TESTNET' : '', prefix);
  return pair
    ? JSON.stringify({
        network,
        path: pair.path,
        passwordBase64: Buffer.from(pair.password).toString('base64'),
      })
    : '';
}

export function renderOperatorEnvironment(
  existing,
  network,
  payload = '',
  prefix = 'ADS_OPERATOR',
) {
  if (!['base', 'base-sepolia'].includes(network)) throw new Error('Invalid operator network.');
  const pairs = {
    '': operatorKeystorePair(existing, '', prefix),
    _TESTNET: operatorKeystorePair(existing, '_TESTNET', prefix),
  };
  if (payload) {
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error('The operator input is invalid.');
    }
    if (
      parsed.network !== network ||
      typeof parsed.path !== 'string' ||
      typeof parsed.passwordBase64 !== 'string'
    ) {
      throw new Error('The operator input does not match the selected network.');
    }
    const pair = operatorKeystorePair(
      {
        [`${prefix}_KEYSTORE_PATH`]: parsed.path,
        [`${prefix}_KEYSTORE_PASSWORD_BASE64`]: parsed.passwordBase64,
      },
      '',
      prefix,
    );
    if (!pair) throw new Error('The operator input is empty.');
    pairs[network === 'base-sepolia' ? '_TESTNET' : ''] = pair;
  }
  return Object.entries(pairs)
    .flatMap(([suffix, pair]) =>
      Object.entries(encodedOperatorPair(pair, suffix, prefix)).map(
        ([key, value]) => `${key}=${shellSafeValue(value)}`,
      ),
    )
    .join('\n');
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href
) {
  try {
    const [action, network, filename] = process.argv.slice(2);
    const prefix = action?.startsWith('price-') ? 'ADS_PRICE_UPDATER' : 'ADS_OPERATOR';
    if (action === 'payload' || action === 'price-payload')
      process.stdout.write(operatorPayload(process.env, network, prefix));
    else if (action === 'render' || action === 'price-render') {
      const existing = filename ? parseEnv(readFileSync(filename, 'utf8')) : {};
      process.stdout.write(
        renderOperatorEnvironment(existing, network, readFileSync(0, 'utf8'), prefix),
      );
    } else throw new Error('Invalid operator environment operation.');
  } catch {
    process.stderr.write(
      'The operator keystore environment could not be prepared. Check the selected network, file path and password.\n',
    );
    process.exitCode = 1;
  }
}
