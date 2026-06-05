-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "eventType" VARCHAR(32) NOT NULL,
    "description" TEXT,
    "scheduledDate" DATE,
    "state" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "tierSlug" TEXT,
    "features" JSONB NOT NULL DEFAULT '{}',
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "shareSlug" VARCHAR(64),
    "customSubdomain" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provisionedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_addon" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "addonSlug" TEXT NOT NULL,
    "paymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_addon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "purposeRef" VARCHAR(64),
    "amountMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "processor" VARCHAR(32) NOT NULL,
    "processorReference" VARCHAR(128),
    "status" VARCHAR(32) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "rawPayload" JSONB,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "processorReference" VARCHAR(128),
    "status" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorUserId" TEXT,
    "eventId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "details" JSONB,
    "ipAddress" INET,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_shareSlug_key" ON "event"("shareSlug");

-- CreateIndex
CREATE UNIQUE INDEX "event_customSubdomain_key" ON "event"("customSubdomain");

-- CreateIndex
CREATE INDEX "event_creatorId_idx" ON "event"("creatorId");

-- CreateIndex
CREATE INDEX "event_state_scheduledDate_idx" ON "event"("state", "scheduledDate");

-- CreateIndex
CREATE INDEX "event_addon_eventId_idx" ON "event_addon"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_addon_eventId_addonSlug_key" ON "event_addon"("eventId", "addonSlug");

-- CreateIndex
CREATE UNIQUE INDEX "payment_processorReference_key" ON "payment"("processorReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotencyKey_key" ON "payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_eventId_idx" ON "payment"("eventId");

-- CreateIndex
CREATE INDEX "payment_status_initiatedAt_idx" ON "payment"("status", "initiatedAt");

-- CreateIndex
CREATE INDEX "refund_paymentId_idx" ON "refund"("paymentId");

-- CreateIndex
CREATE INDEX "audit_log_eventId_createdAt_idx" ON "audit_log"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorUserId_createdAt_idx" ON "audit_log"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_tierSlug_fkey" FOREIGN KEY ("tierSlug") REFERENCES "tier"("slug") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_addon" ADD CONSTRAINT "event_addon_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_addon" ADD CONSTRAINT "event_addon_addonSlug_fkey" FOREIGN KEY ("addonSlug") REFERENCES "addon"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_addon" ADD CONSTRAINT "event_addon_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
