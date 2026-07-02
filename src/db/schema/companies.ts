import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    companyId: uuid("company_id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name"), // entity-dedup key; set by the sourcing layer
    description: text("description"),
    profile: jsonb("profile"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_normalized_name_uq").on(t.normalizedName)],
);
