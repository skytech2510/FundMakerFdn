// 2/ yarn stats -i input.csv -r referenced.csv, compare 2 csv to get Alpha, Beta, Sharpe ratio, Rsquared of input vs reference
import fs from "fs";
import csv from "csv-parser";
import { program } from "commander";

program
  .option("-i, --input <path>", "Path to input CSV file")
  .option("-r, --reference <path>", "Path to reference CSV file")
  .option("-s, --start-date <date>", "Start date for analysis (YYYY-MM-DD)")
  .option("-e, --end-date <date>", "End date for analysis (YYYY-MM-DD)")
  .parse(process.argv);

const options = program.opts();

if (!options.input || !options.reference) {
  console.error("Please provide both input and reference CSV file paths");
  process.exit(1);
}

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const data = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => data.push(row))
      .on("end", () => resolve(data))
      .on("error", (error) => reject(error));
  });

  export const spotPrices = sqliteTable(
    "spot_prices",
    {
      id: integer("id").primaryKey({ autoIncrement: true }),
      symbol: text("symbol").notNull(),
      timestamp: integer("timestamp").notNull(),
      open: real("open").notNull(),
      high: real("high").notNull(),
      low: real("low").notNull(),
      close: real("close").notNull(),
      volume: real("volume").notNull(),
    },
    (table) => ({
      symbolTimestampIdx: uniqueIndex("spot_prices_symbol_timestamp_idx").on(
        table.symbol,
        table.timestamp
      ),
      timestampIdx: index("spot_prices_timestamp_idx").on(table.timestamp),
    })
  );
}

function filterDataByDateRange(data, startDate, endDate) {
  return data.filter((row) => {
    const date = new Date(row.closeTimestamp);
    return date >= startDate && date <= endDate;
  });
}

function calculateStats(inputData, referenceData) {
  const inputReturns = inputData.map((row) => parseFloat(row.pnlPercent));
  const referenceReturns = referenceData.map((row) =>
    parseFloat(row.pnlPercent)
  );

  if (inputReturns.length !== referenceReturns.length) {
    throw new Error("Input and reference data have different lengths");
  }

  // Calculate average returns
  const avgInputReturn =
    inputReturns.reduce((a, b) => a + b, 0) / inputReturns.length;
  const avgReferenceReturn =
    referenceReturns.reduce((a, b) => a + b, 0) / referenceReturns.length;

  // Calculate Beta
  const covariance =
    inputReturns.reduce(
      (sum, _, i) =>
        sum +
        (inputReturns[i] - avgInputReturn) *
          (referenceReturns[i] - avgReferenceReturn),
      0
    ) / inputReturns.length;

  const referenceVariance =
    referenceReturns.reduce(
      (sum, value) => sum + Math.pow(value - avgReferenceReturn, 2),
      0
    ) / referenceReturns.length;

  const beta = covariance / referenceVariance;

  // Calculate Alpha
  const alpha = avgInputReturn - beta * avgReferenceReturn;

  // Calculate R-squared
  const totalSumSquares = inputReturns.reduce(
    (sum, value) => sum + Math.pow(value - avgInputReturn, 2),
    0
  );
  const residualSumSquares = inputReturns.reduce(
    (sum, _, i) =>
      sum + Math.pow(inputReturns[i] - (beta * referenceReturns[i] + alpha), 2),
    0
  );
  const rSquared = 1 - residualSumSquares / totalSumSquares;

  // Calculate Sharpe Ratio (assuming risk-free rate of 0 for simplicity)
  const inputStdDev = Math.sqrt(
    inputReturns.reduce(
      (sum, value) => sum + Math.pow(value - avgInputReturn, 2),
      0
    ) / inputReturns.length
  );
  const sharpeRatio = avgInputReturn / inputStdDev;

  // Calculate Maximum Drawdown and Total Return
  let peak = -Infinity;
  let maxDrawdown = 0;
  let cumulativeReturn = 1;
  for (const ret of inputReturns) {
    cumulativeReturn *= 1 + ret / 100;
    if (cumulativeReturn > peak) peak = cumulativeReturn;
    const drawdown = (peak - cumulativeReturn) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const totalReturn = (cumulativeReturn - 1) * 100;

  return {
    alpha,
    beta,
    sharpeRatio,
    rSquared,
    maxDrawdown,
    totalReturn,
  };
}

function generateMonthlyPnLTable(inputData) {
  const monthlyPnL = {};

  inputData.forEach((row) => {
    const date = new Date(row.closeTimestamp);
    const monthYear = `${date.getFullYear()}-${(date.getMonth() + 1)
      .toString()
      .padStart(2, "0")}`;

    if (!monthlyPnL[monthYear]) {
      monthlyPnL[monthYear] = 0;
    }

    monthlyPnL[monthYear] += parseFloat(row.pnlPercent);
  });

  return monthlyPnL;
}

function printMonthlyPnLTable(monthlyPnL) {
  const months = Object.keys(monthlyPnL).sort();
  const chunkedMonths = [];
  for (let i = 0; i < months.length; i += 12) {
    chunkedMonths.push(months.slice(i, i + 12));
  }

  chunkedMonths.forEach((chunk) => {
    // Print month-year headers
    console.log(chunk.map((month) => month.padEnd(8)).join(" "));

    // Print PnL values
    console.log(
      chunk.map((month) => monthlyPnL[month].toFixed(2).padStart(8)).join(" ")
    );

    console.log(); // Empty line between chunks
  });
}

async function main() {
  try {
    const [inputData, referenceData] = await Promise.all([
      parseCSV(options.input),
      parseCSV(options.reference),
    ]);

    let startDate, endDate;
    if (options.startDate && options.endDate) {
      startDate = new Date(options.startDate);
      endDate = new Date(options.endDate);
    } else {
      // Find common date range
      const inputDates = inputData.map((row) => new Date(row.closeTimestamp));
      const referenceDates = referenceData.map(
        (row) => new Date(row.closeTimestamp)
      );
      startDate = new Date(
        Math.max(Math.min(...inputDates), Math.min(...referenceDates))
      );
      endDate = new Date(
        Math.min(Math.max(...inputDates), Math.max(...referenceDates))
      );
    }

    const filteredInputData = filterDataByDateRange(
      inputData,
      startDate,
      endDate
    );
    const filteredReferenceData = filterDataByDateRange(
      referenceData,
      startDate,
      endDate
    );

    const stats = calculateStats(filteredInputData, filteredReferenceData);
    const monthlyPnL = generateMonthlyPnLTable(filteredInputData);

    console.log("Statistics:");
    console.log(
      `Date Range: ${startDate.toISOString().split("T")[0]} to ${
        endDate.toISOString().split("T")[0]
      }`
    );
    console.log(`Alpha: ${stats.alpha.toFixed(4)}`);
    console.log(`Beta: ${stats.beta.toFixed(4)}`);
    console.log(`Sharpe Ratio: ${stats.sharpeRatio.toFixed(4)}`);
    console.log(`R-squared: ${stats.rSquared.toFixed(4)}`);
    console.log(`Maximum Drawdown: ${(stats.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Total Return: ${stats.totalReturn.toFixed(2)}%`);

    console.log("\nMonthly PnL Table (%):");
    printMonthlyPnLTable(monthlyPnL);
  } catch (error) {
    console.error("An error occurred:", error.message);
    process.exit(1);
  }
}

main();
