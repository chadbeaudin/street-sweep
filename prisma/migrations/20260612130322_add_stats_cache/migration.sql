-- CreateTable
CREATE TABLE "stats_cache" (
    "athleteId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stats_cache_pkey" PRIMARY KEY ("athleteId")
);
