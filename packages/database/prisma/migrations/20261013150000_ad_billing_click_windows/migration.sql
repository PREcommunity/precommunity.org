CREATE TABLE "AdBillingClickWindow" (
    "fingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdBillingClickWindow_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "AdBillingClickWindow_expiresAt_idx" ON "AdBillingClickWindow"("expiresAt");
