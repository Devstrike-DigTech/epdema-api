-- CreateTable
CREATE TABLE "scheduled_reminder" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "inviteeId" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    "bullJobId" VARCHAR(120),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "scheduled_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_reminder_eventId_status_idx" ON "scheduled_reminder"("eventId", "status");

-- CreateIndex
CREATE INDEX "scheduled_reminder_runAt_status_idx" ON "scheduled_reminder"("runAt", "status");

-- CreateIndex
CREATE INDEX "scheduled_reminder_bullJobId_idx" ON "scheduled_reminder"("bullJobId");

-- AddForeignKey
ALTER TABLE "scheduled_reminder" ADD CONSTRAINT "scheduled_reminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reminder" ADD CONSTRAINT "scheduled_reminder_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "event_invitee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
