-- CreateTable
CREATE TABLE "segment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "segmentType" VARCHAR(32) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "state" VARCHAR(32) NOT NULL DEFAULT 'open',
    "lockedValue" JSONB,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal" (
    "id" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "proposedById" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "state" VARCHAR(32) NOT NULL DEFAULT 'live',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objection" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT,
    "state" VARCHAR(32) NOT NULL DEFAULT 'live',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segment_eventId_state_idx" ON "segment"("eventId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "segment_eventId_position_key" ON "segment"("eventId", "position");

-- CreateIndex
CREATE INDEX "proposal_segmentId_state_idx" ON "proposal"("segmentId", "state");

-- CreateIndex
CREATE INDEX "objection_proposalId_state_idx" ON "objection"("proposalId", "state");

-- AddForeignKey
ALTER TABLE "segment" ADD CONSTRAINT "segment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment" ADD CONSTRAINT "segment_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objection" ADD CONSTRAINT "objection_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objection" ADD CONSTRAINT "objection_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
