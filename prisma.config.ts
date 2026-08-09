import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "database/schema/schema.prisma",
  migrations: {
    path: "database/migrations",
    seed: "tsx database/seed/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
