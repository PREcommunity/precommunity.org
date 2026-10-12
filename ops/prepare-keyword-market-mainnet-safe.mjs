import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const taskRequire = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { createPublicClient, http, getAddress, encodeFunctionData, decodeFunctionData } = taskRequire('viem');
const { base } = taskRequire('viem/chains');
const { Interface } = taskRequire('ethers');
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const escrowRoot = fileURLToPath(new URL('../../escrow/', import.meta.url));
const safe = getAddress('0x01f3B3AF1d8B6c1E6Dd489a2E67D150C19Aa3c49');
const pre = getAddress('0x3816dD4bd44c8830c2FA020A5605bAC72FA3De7A');
const operator = getAddress('0x0d937fa55cD43F6DE0bf6d484317c332F366C5fe');
const updater = getAddress('0x3329B77a219a70D9732b509461C874480e618abE');
const artifact = JSON.parse(readFileSync(`${appRoot}/packages/shared/abi/PREKeywordMarketV1.json`, 'utf8'));
const abi = artifact.abi;
const ethersInterface = new Interface(abi);

function roleTransaction(contract, methodName, address) {
  const target = getAddress(contract);
  assert(![safe, pre, operator, updater, '0x0000000000000000000000000000000000000000'].includes(target));
  const method = abi.find((entry) => entry.type === 'function' && entry.name === methodName);
  const data = encodeFunctionData({ abi, functionName: methodName, args: [address] });
  assert.equal(data, ethersInterface.encodeFunctionData(methodName, [address]));
  assert.equal(getAddress(decodeFunctionData({ abi, data }).args[0]), address);
  return { to: target, value: '0', data, contractMethod: { inputs: method.inputs, name: methodName, payable: false }, contractInputsValues: { [method.inputs[0].name]: address } };
}

function normalizedRuntime(code) {
  assert(/^0x(?:[a-fA-F0-9]{2})+$/.test(code));
  assert(Object.keys(artifact.immutableReferences ?? {}).length > 0);
  const chars = code.slice(2).toLowerCase().split('');
  for (const references of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of references) chars.fill('0', start * 2, (start + length) * 2);
  }
  return chars.join('');
}

function saveJson(filename, value) {
  writeFileSync(`${filename}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  renameSync(`${filename}.tmp`, filename);
}

async function main() {
  assert.notEqual(operator, updater);
  if (process.argv.includes('--self-check')) {
    const target = '0x1111111111111111111111111111111111111111';
    assert.equal(roleTransaction(target, 'setOperator', operator).data.slice(0, 10), '0xb3ab15fb');
    assert.equal(roleTransaction(target, 'setPriceUpdater', updater).data.slice(0, 10), '0x97c4a5f3');
    assert.throws(() => roleTransaction(pre, 'setOperator', operator));
    assert.throws(() => roleTransaction('0x0000000000000000000000000000000000000000', 'setOperator', operator));
    console.log('Base Safe JSON self-check passed. No files or transactions created.');
    return;
  }
  assert.equal(process.argv.length, 2, 'Run without arguments after the mainnet deployment.');
  const manifest = JSON.parse(readFileSync(`${escrowRoot}/.deployments/base.keyword-market-v1.price-coverage-20261012.json`, 'utf8'));
  assert.equal(manifest.schema, 'precommunity.keyword-market-deployment.v1');
  assert.equal(manifest.stage, 'confirmed');
  assert.equal(manifest.network, 'base');
  assert.equal(manifest.chainId, 8453);
  assert.equal(manifest.transactionStatus, 1);
  assert.equal(manifest.startPaused, false, 'The mainnet deployment must start without a pause.');
  assert(manifest.confirmations >= manifest.requiredConfirmations && manifest.requiredConfirmations >= 6);
  assert.equal(getAddress(manifest.owner), safe);
  assert.equal(getAddress(manifest.preAddress), pre);
  const contract = getAddress(manifest.contractAddress);
  const env = parseEnv(readFileSync(`${escrowRoot}/.env`, 'utf8'));
  const client = createPublicClient({ chain: base, transport: http(env.BASE_MAINNET_RPC_URL || env.BASE_RPC_URL || 'https://mainnet.base.org', { timeout: 15000, retryCount: 0 }) });
  assert.equal(await client.getChainId(), 8453);
  const blockNumber = await client.getBlockNumber();
  const read = (functionName) => client.readContract({ address: contract, abi, functionName, blockNumber });
  const [receipt, code, owner, token, paused, minimum] = await Promise.all([
    client.getTransactionReceipt({ hash: manifest.transactionHash }), client.getCode({ address: contract, blockNumber }),
    read('owner'), read('PRE'), read('paused'), read('minimumStake'),
  ]);
  assert.equal(receipt.status, 'success');
  assert.equal(getAddress(receipt.contractAddress), contract);
  assert.equal(getAddress(receipt.from), getAddress(manifest.deployer));
  assert.equal(receipt.blockNumber.toString(), String(manifest.deploymentBlock));
  assert(blockNumber - receipt.blockNumber + 1n >= BigInt(manifest.requiredConfirmations));
  const receiptBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  assert.equal(receiptBlock.hash, receipt.blockHash);
  assert.equal(normalizedRuntime(code), normalizedRuntime(artifact.deployedBytecode));
  assert.equal(getAddress(owner), safe);
  assert.equal(getAddress(token), pre);
  assert.equal(paused, false, 'The mainnet contract is unexpectedly paused.');
  assert.equal(minimum.toString(), manifest.initialMinimumStakeRaw);
  const operatorTx = roleTransaction(contract, 'setOperator', operator);
  const updaterTx = roleTransaction(contract, 'setPriceUpdater', updater);
  for (const [functionName, address] of [['setOperator', operator], ['setPriceUpdater', updater]]) {
    await client.simulateContract({ address: contract, abi, functionName, args: [address], account: safe, blockNumber });
  }
  mkdirSync(`${appRoot}/reports`, { recursive: true });
  for (const [name, transactions] of [['set-operator', [operatorTx]], ['set-price-updater', [updaterTx]], ['set-roles', [operatorTx, updaterTx]]]) {
    const filename = `${appRoot}/reports/keyword-market-base-price-coverage-${name}.tx-builder.json`;
    saveJson(filename, { version: '1.0', chainId: '8453', createdAt: Date.now(), meta: { name: `Base: ${name} for PRE price coverage`, description: 'Configure the selected billing operator and/or separate PRE/USD updater. No pause or unpause call.', createdFromSafeAddress: safe }, transactions });
    console.log(filename);
  }
  console.log(JSON.stringify({ chainId: 8453, contractAddress: contract, paused, operator, priceUpdater: updater, verifiedBlock: blockNumber.toString(), deploymentTransactionHash: manifest.transactionHash }));
}

main().catch((error) => {
  console.error(error instanceof assert.AssertionError ? `Safe JSON validation failed: ${error.message}` : 'Safe JSON preparation failed. Check the confirmed mainnet manifest and RPC. No role-setting transaction was signed or sent.');
  process.exitCode = 1;
});
