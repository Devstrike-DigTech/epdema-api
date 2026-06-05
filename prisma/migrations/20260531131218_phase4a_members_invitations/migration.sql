-- CreateTable
CREATE TABLE "planning_member" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'contributor',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedById" TEXT,

    CONSTRAINT "planning_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_invitation" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'contributor',
    "token" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "event_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planning_member_eventId_idx" ON "planning_member"("eventId");

-- CreateIndex
CREATE INDEX "planning_member_userId_idx" ON "planning_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "planning_member_eventId_userId_key" ON "planning_member"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "event_invitation_token_key" ON "event_invitation"("token");

-- CreateIndex
CREATE INDEX "event_invitation_token_idx" ON "event_invitation"("token");

-- CreateIndex
CREATE INDEX "event_invitation_eventId_status_idx" ON "event_invitation"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_invitation_eventId_email_key" ON "event_invitation"("eventId", "email");

-- AddForeignKey
ALTER TABLE "planning_member" ADD CONSTRAINT "planning_member_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planning_member" ADD CONSTRAINT "planning_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitation" ADD CONSTRAINT "event_invitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitation" ADD CONSTRAINT "event_invitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
