import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import CONFIG from "./config.js";

// Initialize SQLite connection
const sqlite = new Database(CONFIG.dbFilename);

// Initialize Drizzle ORM with SQLite connection
const db = drizzle(sqlite);

// Export database connection and schema
export default db;
