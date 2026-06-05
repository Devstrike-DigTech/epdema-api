-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "eventId" UUID,
    "actorUserId" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMinor" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_eventId_createdAt_idx" ON "ai_usage"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_actorUserId_createdAt_idx" ON "ai_usage"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
