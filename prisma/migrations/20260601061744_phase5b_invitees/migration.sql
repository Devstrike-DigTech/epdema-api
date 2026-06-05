-- CreateTable
CREATE TABLE "event_invitee" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(120),
    "rsvpToken" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "customAnswers" JSONB,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "event_invitee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_invitee_rsvpToken_key" ON "event_invitee"("rsvpToken");

-- CreateIndex
CREATE INDEX "event_invitee_rsvpToken_idx" ON "event_invitee"("rsvpToken");

-- CreateIndex
CREATE INDEX "event_invitee_eventId_status_idx" ON "event_invitee"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_invitee_eventId_email_key" ON "event_invitee"("eventId", "email");

-- AddForeignKey
ALTER TABLE "event_invitee" ADD CONSTRAINT "event_invitee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitee" ADD CONSTRAINT "event_invitee_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
