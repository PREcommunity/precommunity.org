import './load-env';
import { PRECOMMUNITY_ESCROW_ABI } from '@precommunity/shared';
import { createPublicClient, getAddress, http } from 'viem';
import { config } from './config';
import { verifyEscrowManifest } from './escrow-manifest';

async function main() {
  const client = createPublicClient({ chain: config.chain, transport: http(config.BASE_RPC_URL) });
  const address = getAddress(config.deployment.escrowAddress);
  const fromBlock = BigInt(config.deployment.deploymentBlock);
  const currentBlock = await client.getBlockNumber();
  const toBlock = currentBlock < fromBlock + 1_999n ? currentBlock : fromBlock + 1_999n;
  const [manifest, rawAtDeployment, strictAtDeployment, looseAtDeployment, strictChunk] =
    await Promise.all([
      verifyEscrowManifest(client, config.deployment, config.SAFE_ADDRESS),
      client.getLogs({ address, fromBlock, toBlock: fromBlock }),
      client.getContractEvents({
        address,
        abi: PRECOMMUNITY_ESCROW_ABI,
        fromBlock,
        toBlock: fromBlock,
        strict: true,
      }),
      client.getContractEvents({
        address,
        abi: PRECOMMUNITY_ESCROW_ABI,
        fromBlock,
        toBlock: fromBlock,
        strict: false,
      }),
      client.getContractEvents({
        address,
        abi: PRECOMMUNITY_ESCROW_ABI,
        fromBlock,
        toBlock,
        strict: true,
      }),
    ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        manifest,
        address,
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        rawAtDeployment: rawAtDeployment.length,
        strictAtDeployment: strictAtDeployment.map((log) => log.eventName),
        looseAtDeployment: looseAtDeployment.map((log) => log.eventName),
        strictChunk: strictChunk.map((log) => ({
          eventName: log.eventName,
          blockNumber: log.blockNumber.toString(),
        })),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
