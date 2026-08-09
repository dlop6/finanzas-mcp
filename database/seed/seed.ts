import { prisma } from "../client";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The local seed cannot run in production");
  }

  await prisma.$queryRaw`SELECT 1`;
  console.log("Seed hook completed; no financial entities are inserted in UN-5.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
