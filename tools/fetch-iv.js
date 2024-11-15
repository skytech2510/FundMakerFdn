import { program } from "commander";
import { fetchAndSaveIVData } from "#src/fetch-utils.js";
import CONFIG from "#src/config.js";

program
  .option("-r, --resolution <resolution>", "Resolution (e.g., 60)", "60")
  .option("-f, --from <date>", "From date (YYYY-MM-DD)")
  .option("-t, --to <date>", "To date (YYYY-MM-DD)")
  .parse(process.argv);

const options = program.opts();

if (!options.from || !options.to) {
  console.error("Please provide both from and to dates");
  process.exit(1);
}

async function main() {
  for (const symbol of CONFIG.IV_SYMBOLS) {
    console.log(`Fetching data for symbol: ${symbol}`);
    await fetchAndSaveIVData(symbol, options.resolution, options.from, options.to);
  }
}

main().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
