-- CreateTable
CREATE TABLE "osm_cache" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "osm_cache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "coordinates" JSONB NOT NULL,
    "distance" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_routes" (
    "collectionId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_routes_pkey" PRIMARY KEY ("collectionId","routeId")
);

-- CreateTable
CREATE TABLE "strava_activities" (
    "stravaId" TEXT NOT NULL,
    "name" TEXT,
    "polyline" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strava_activities_pkey" PRIMARY KEY ("stravaId")
);

-- AddForeignKey
ALTER TABLE "collection_routes" ADD CONSTRAINT "collection_routes_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_routes" ADD CONSTRAINT "collection_routes_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
