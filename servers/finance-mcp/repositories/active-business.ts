import type { Business, PrismaClient } from "@/database/generated/prisma/client";

import { ActiveBusinessAmbiguousError, ActiveBusinessNotFoundError, normalizePersistenceError } from "./errors";

export async function getActiveBusiness(prisma: Pick<PrismaClient, "business">): Promise<Business> {
  try {
    const businesses = await prisma.business.findMany({
      orderBy: { id: "asc" },
      take: 2,
    });

    if (businesses.length === 0) {
      throw new ActiveBusinessNotFoundError();
    }

    if (businesses.length > 1) {
      throw new ActiveBusinessAmbiguousError();
    }

    return businesses[0];
  } catch (error) {
    throw normalizePersistenceError(error, "Business");
  }
}
