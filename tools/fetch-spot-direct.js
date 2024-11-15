import { program } from "commander";
import { fetchAndSaveSpotData } from "#src/fetch-utils.js";

program
  .option("-i, --interval <interval>", "Interval (e.g., 15m, 1h, 1d)", "1h")
  .option("-s, --start-date <date>", "Start date (YYYY-MM-DD)")
  .option("-e, --end-date <date>", "End date (YYYY-MM-DD)")
  .parse(process.argv);

const options = program.opts();

if (!options.startDate || !options.endDate) {
  console.error("Please provide both start and end dates");
  process.exit(1);
}

async function main() {
  await fetchAndSaveSpotData(options.interval, options.startDate, options.endDate);
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
