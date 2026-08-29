-- Contract ownership and goal-manager grants are the source of truth for chain authority.
CREATE TYPE "ChainAuthorityKind" AS ENUM ('OWNER', 'GOAL_MANAGER');

CREATE TABLE "ChainAuthority" (
    "id" UUID NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" "ChainAuthorityKind" NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainAuthority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChainAuthority_chainId_contractAddress_address_kind_key"
ON "ChainAuthority"("chainId", "contractAddress", "address", "kind");

CREATE INDEX "ChainAuthority_chainId_contractAddress_address_idx"
ON "ChainAuthority"("chainId", "contractAddress", "address");

CREATE INDEX "ChainAuthority_chainId_contractAddress_kind_idx"
ON "ChainAuthority"("chainId", "contractAddress", "kind");

-- SUPER_ADMIN is now derived only from the confirmed contract owner.
UPDATE "User"
SET "roles" = array_remove("roles", 'SUPER_ADMIN'::"Role")
WHERE "roles" @> ARRAY['SUPER_ADMIN'::"Role"];
