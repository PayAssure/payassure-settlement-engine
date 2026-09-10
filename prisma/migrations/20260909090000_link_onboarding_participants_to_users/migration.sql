ALTER TABLE "OnboardingParticipant"
ADD COLUMN "userId" TEXT;

UPDATE "OnboardingParticipant" AS participant
SET "userId" = "User"."id"
FROM "User"
WHERE participant."userId" IS NULL
	AND participant."email" IS NOT NULL
	AND LOWER(participant."email") = LOWER("User"."email");

CREATE UNIQUE INDEX "OnboardingParticipant_userId_key" ON "OnboardingParticipant"("userId");

ALTER TABLE "OnboardingParticipant"
ADD CONSTRAINT "OnboardingParticipant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
