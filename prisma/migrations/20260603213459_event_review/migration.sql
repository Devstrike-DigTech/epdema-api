-- CreateTable
CREATE TABLE "event_review" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "revieweeId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "weight" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_review_revieweeId_createdAt_idx" ON "event_review"("revieweeId", "createdAt");

-- CreateIndex
CREATE INDEX "event_review_eventId_createdAt_idx" ON "event_review"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_review_eventId_reviewerId_revieweeId_key" ON "event_review"("eventId", "reviewerId", "revieweeId");

-- AddForeignKey
ALTER TABLE "event_review" ADD CONSTRAINT "event_review_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_review" ADD CONSTRAINT "event_review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_review" ADD CONSTRAINT "event_review_revieweeId_fkey" FOREIGN KEY ("revieweeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
