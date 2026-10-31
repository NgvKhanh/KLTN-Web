-- CreateTable
CREATE TABLE "CardReminder" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardReminder_sentAt_idx" ON "CardReminder"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardReminder_cardId_userId_offsetMinutes_key" ON "CardReminder"("cardId", "userId", "offsetMinutes");

-- AddForeignKey
ALTER TABLE "CardReminder" ADD CONSTRAINT "CardReminder_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardReminder" ADD CONSTRAINT "CardReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
