import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/primus_privacy",
  },
} satisfies Config;
