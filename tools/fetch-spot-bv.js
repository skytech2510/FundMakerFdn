import https from "https";
import AdmZip from "adm-zip";
import { program } from "commander";
import { batchInsert } from "#src/db-utils.js";
import db from "#src/database.js";
import { spot } from "#src/schema.js";
import CONFIG from "#src/config.js";

program
  .option("-i, --interval <interval>", "Interval (e.g., 1s, 1m, 1h)", "1s")
  .option("-s, --start-date <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end-date <date>", "End date (YYYY-MM-DD)")
  .parse(process.argv);

const options = program.opts();

if (!options.startDate || !options.endDate) {
  console.error("Please provide both start and end dates");
  process.exit(1);
}

// Function to generate dates within range
function* dateRange(start, end) {
  let current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    yield current.toISOString().slice(0, 10).replace(/-/g, "");
    current.setDate(current.getDate() + 1);
  }
}

// Function to process a single date for all tickers
async function processDate(date) {
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  const day = date.slice(6);
  const formattedDate = `${year}-${month}-${day}`;

  console.log(`Processing ${formattedDate}...`);

  for (const ticker of CONFIG.SPOT_SYMBOLS) {
    const url = `https://data.binance.vision/data/spot/daily/klines/${ticker}/${options.interval}/${ticker}-${options.interval}-${formattedDate}.zip`;

    try {
      // Download and process the zip file
      const zipBuffer = await new Promise((resolve, reject) => {
        https
          .get(url, (response) => {
            if (response.statusCode !== 200) {
              reject(`Failed to download: ${response.statusCode}`);
              return;
            }

            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks)));
          })
          .on("error", reject);
      });

      console.log(`Zip file for ${ticker} downloaded successfully.`);

      // Unzip the file in memory
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      if (zipEntries.length > 0) {
        const csvContent = zip.readAsText(zipEntries[0]);

        // Process CSV content
        const rows = csvContent
          .trim()
          .split("\n")
          .map((line) => {
            const [timestamp, open, high, low, close, volume, ...rest] =
              line.split(",");
            return {
              symbol: ticker,
              interval: options.interval,
              timestamp: parseInt(timestamp),
              open: parseFloat(open),
              high: parseFloat(high),
              low: parseFloat(low),
              close: parseFloat(close),
              volume: parseFloat(volume),
            };
          });

        // Save to database
        await saveToDatabase(rows);
        console.log(
          `Saved ${rows.length} records for ${ticker} (${formattedDate}) to the database`
        );
      } else {
        console.error(`No files found in the zip archive for ${ticker}.`);
      }
    } catch (error) {
      console.error(`Error processing ${ticker} for ${formattedDate}:`, error);
    }
  }
}

// Function to save data to the database
async function saveToDatabase(rows) {
  try {
    if (rows.length > 0) {
      await batchInsert(db, spot, rows);
    } else {
      console.log(`No valid records to save for this batch`);
    }
  } catch (error) {
    console.error(`Error saving to database:`, error);
  }
}

// Main function to process all dates
async function processAllDates() {
  for (const date of dateRange(options.startDate, options.endDate)) {
    await processDate(date);
  }
  console.log("All dates processed.");
}

// Run the script
processAllDates().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
