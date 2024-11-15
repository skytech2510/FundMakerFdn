import db from "#src/database.js";
import { pools } from "#src/schema.js";
import fs from "fs";
import { program } from "commander";
import { Parser } from "@json2csv/plainjs";
import csvParser from "csv-parser"; // For parsing CSV file
import { sql } from "drizzle-orm";

async function poolsCSV(opts) {
  if (opts.import) {
    // Handle CSV import and override the table
    const csvData = [];

    // Read and parse the CSV file
    fs.createReadStream(opts.import)
      .pipe(csvParser())
      .on("data", (row) => csvData.push(row))
      .on("end", async () => {
        try {
          await db.run(sql`PRAGMA foreign_keys = OFF`);
          await db.delete(pools);
          if (csvData.length > 0)
            await db.insert(pools).values(csvData).execute();
          console.log(`Data successfully imported from ${opts.import}`);
        } catch (err) {
          console.error("Error inserting data into the database:", err);
        }
      })
      .on("error", (err) => {
        console.error(`Error reading the CSV file: ${err}`);
      });
    return;
  }

  // Handle CSV export or print
  const rows = await db.select().from(pools);

  if (rows.length === 0) {
    console.log("Pools table is empty.");
    return;
  }

  const csv = new Parser().parse(rows);

  if (opts.export) {
    fs.writeFile(opts.export, csv, (err) => {
      if (err) {
        console.error(`Error writing to file: ${err}`);
      } else {
        console.log(`CSV successfully written to ${opts.export}`);
      }
    });
  }

  if (opts.print || !opts.export) {
    console.log(csv);
  }

  console.log("Pool count:", rows.length);
}

program
  .description("Print, export, or import CSV data for pools from the database")
  .option("-e, --export <file>", "export CSV to file")
  .option("-p, --print", "print CSV to stdout (default behavior)")
  .option(
    "-i, --import <file>",
    "import data from a CSV file and override the pools table"
  )
  .action(poolsCSV);

program.parse(process.argv);
