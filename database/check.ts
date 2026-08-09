import "dotenv/config";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const { prisma } = await import("./client");

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Database connection OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown database error";
  const safeMessage = message.includes("DATABASE_URL") ? "DATABASE_URL is required" : "Database connection failed";
  console.error(safeMessage);
  process.exitCode = 1;
});
