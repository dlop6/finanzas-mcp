import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/database/generated/prisma/client";
import { getValidatedTestDatabaseUrl } from "@/database/test/test-database-config";

export function createTestPrisma(): PrismaClient {
  const url = getValidatedTestDatabaseUrl();
  return new PrismaClient({ adapter: new PrismaPg(url) });
}
