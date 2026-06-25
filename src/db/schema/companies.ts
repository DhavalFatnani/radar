import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  companyId: uuid("company_id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  profile: jsonb("profile"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
