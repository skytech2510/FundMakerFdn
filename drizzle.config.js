import { defineConfig } from "drizzle-kit";
import CONFIG from "./src/config.js";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: CONFIG.dbFilename,
  },
});
