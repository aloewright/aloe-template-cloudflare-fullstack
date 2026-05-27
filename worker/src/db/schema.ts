/* AGPL-3.0-or-later */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const subscriptions = sqliteTable("subscriptions", {
  // Polar subscription id (sub_xxx); primary key so webhooks upsert cleanly.
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  productId: text("product_id").notNull(),
  priceId: text("price_id"),
  // active | canceled | past_due | incomplete | trialing — see Polar docs.
  status: text("status").notNull(),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
