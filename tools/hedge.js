import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import {
  getFirstSpotPrice,
  filterFirstSpotPrice,
  getHistIV,
  getPoolMetadata,
  getAllTrades,
} from "#src/db-utils.js";
import { simulateTrading } from "#src/simulate.js";
import {
  blackScholes,
  calculateGreeks,
  adjustStrikePrice,
  calculateExpirationDate,
} from "#src/options-math.js";
import CONFIG from "#src/config.js";

function log(...message) {
  if (CONFIG.VERBOSE) {
    console.log(...message);
  }
}

function readCSVFiles(directoryPath) {
  const files = fs
    .readdirSync(directoryPath)
    .filter((file) => file.endsWith(".csv"));
  const allData = [];

  for (const file of files) {
    const filePath = path.join(directoryPath, file);
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });
    allData.push({ file, records });
  }

  return allData;
}

async function processData(data, strategy) {
  const results = [];

  for (const { file, records } of data) {
    log(`Processing file: ${file}`);
    const fileResults = [];

    for (const record of records) {
      log(`Processing record: ${JSON.stringify(record)}`);
      const pnlPercentLP = parseFloat(record.pnlPercent);
      const pool = await getPoolMetadata(record.poolType, record.poolAddress);

      // Get trades for the period and simulate trading
      const trades = getAllTrades(
        pool.id,
        new Date(record.openTimestamp),
        new Date(record.closeTimestamp)
      );

      const tradingPositions = await simulateTrading(
        trades,
        strategy,
        record,
        pool,
        record.lpPositionId
      );

      // Store trading positions in the record
      record.tradingPositions = tradingPositions;

      log(`PNL Percent LP: ${pnlPercentLP}%`);
      log(`Trading Positions: ${tradingPositions.length}`);

      // Log trading positions
      tradingPositions.forEach((pos, index) => {
        log(`Trading Position ${index + 1}:`);
        log(`  Type: ${pos.type}`);
        log(`  Open: ${new Date(pos.openTimestamp).toISOString()}`);
        log(`  Close: ${new Date(pos.closeTimestamp).toISOString()}`);
        log(`  Entry Price: ${pos.entryPrice}`);
        log(`  Close Price: ${pos.closePrice}`);
        log(`  PnL %: ${pos.pnlPercent.toFixed(2)}`);
        log(`  PnL USD: ${pos.pnlUSD.toFixed(2)}`);
        log(`  Closed By: ${pos.closedBy}`);
        log("-------------------");
      });

      const optionResults = await Promise.all(
        strategy.options.map(async (option, index) => {
          // log(`Processing option ${index + 1}`);

          let spotSymbol;
          if (option.spotSymbol) {
            spotSymbol = option.spotSymbol;
          } else {
            spotSymbol = pool.type === "Thena_BSC" ? "BNBUSDT" : "ETHUSDT";
          }
          const spotPriceUSD = await getFirstSpotPrice(
            spotSymbol,
            record.openTimestamp
          );
          const indexIV = await getHistIV("EVIV", record.openTimestamp);

          if (!spotPriceUSD || !indexIV) {
            console.log(
              `Missing data for option ${index + 1}: ${JSON.stringify(option)}`
            );
            return null;
          }

          const stepSize = CONFIG.STRIKE_PRICE_STEPS[spotSymbol] || 1;
          const adjustedStrikeMultiplier = adjustStrikePrice(
            spotPriceUSD,
            option.strikePrice,
            stepSize
          );
          const strikePrice = adjustedStrikeMultiplier * spotPriceUSD;

          const expirationDate = calculateExpirationDate(
            new Date(record.openTimestamp),
            option.dte
          );
          const T =
            (expirationDate.getTime() -
              new Date(record.openTimestamp).getTime()) /
            (1000 * 60 * 60 * 24 * 365);
          const r = strategy?.riskFreeRate || 0;

          // Apply askIndexIVRatio to get the option's ask IV
          const askIV = indexIV * option.askIndexIVRatio;

          const price =
            (blackScholes(
              spotPriceUSD,
              strikePrice,
              T,
              r,
              askIV,
              option.optionType
            ) *
              record.amountUSD) /
            spotPriceUSD;
          const greeks = calculateGreeks(
            spotPriceUSD,
            strikePrice,
            T,
            r,
            askIV,
            option.optionType
          );

          // Apply askBidRatio to calculate the bid price
          const bidPrice = price / option.askBidRatio;

          return {
            optionType: option.optionType,
            strikePrice,
            spotSymbol,
            expirationDate: expirationDate.toISOString(),
            start: {
              spotPriceUSD: spotPriceUSD,
              askPremiumUSD: price,
              bidPremiumUSD: bidPrice,
              askIVPercent: askIV,
              indexIVPercent: indexIV,
              ...greeks,
            },
          };
        })
      );

      const validOptionResults = optionResults.filter(
        (result) => result !== null
      );

      if (validOptionResults.length === 0) {
        log(`No valid options for record: ${JSON.stringify(record)}`);
        continue;
      }

      // Calculate pnlOptions and pnlTotal
      let pnlOptionsUSD = 0;
      const updatedOptions = await Promise.all(
        validOptionResults.map(async (option) => {
          const expirationDate = new Date(option.expirationDate);
          let endTimestamp = new Date(record.closeTimestamp);
          let isExpired = false;

          // Check for early close condition based on price movement
          const strategyOption = strategy.options.find(
            (o) => o.optionType === option.optionType
          );
          if (strategyOption.closeCondition) {
            const { uptickPercent, downtickPercent } =
              strategyOption.closeCondition;
            const startSpot = option.start.spotPriceUSD;
            const targetPrice = uptickPercent
              ? startSpot * (1 + uptickPercent / 100)
              : startSpot * (1 - downtickPercent / 100);

            const crossingPoint = await filterFirstSpotPrice(
              targetPrice,
              !!uptickPercent,
              option.spotSymbol,
              record.openTimestamp
            );

            if (crossingPoint && crossingPoint.timestamp < endTimestamp) {
              log(
                `Triggered closeCondition for ${strategyOption.optionType} (open: ${startSpot}):`,
                crossingPoint
              );
              endTimestamp = new Date(crossingPoint.timestamp);
              option.closedByCondition = true;
            } else {
              option.closedByCondition = false;
            }
          } else {
            option.closedByCondition = false;
          }

          // Check if expired
          isExpired = endTimestamp >= expirationDate;

          // Use expiration date for spot price and IV if option has expired
          if (isExpired) {
            endTimestamp = new Date(option.expirationDate);
          }
          const endSpotPrice = await getFirstSpotPrice(
            option.spotSymbol,
            endTimestamp
          );
          const endIndexIV = await getHistIV("EVIV", endTimestamp);
          const endAskIV =
            endIndexIV *
            strategy.options.find((o) => o.optionType === option.optionType)
              .askIndexIVRatio;

          // Calculate remaining time to expiry
          const remainingT = Math.max(
            0,
            (expirationDate - endTimestamp) / (1000 * 60 * 60 * 24 * 365)
          );

          const endPrice =
            (blackScholes(
              endSpotPrice,
              option.strikePrice,
              remainingT,
              strategy.riskFreeRate,
              endAskIV,
              option.optionType
            ) *
              record.amountUSD) /
            endSpotPrice;
          const endBidPrice =
            endPrice /
            strategy.options.find((o) => o.optionType === option.optionType)
              .askBidRatio;
          const endGreeks = calculateGreeks(
            endSpotPrice,
            option.strikePrice,
            remainingT,
            strategy.riskFreeRate,
            endAskIV,
            option.optionType
          );

          const optionPnlUSD = endBidPrice - option.start.askPremiumUSD;
          const optionPnlPercent =
            (endBidPrice / option.start.askPremiumUSD - 1) * 100;
          pnlOptionsUSD += optionPnlUSD;

          return {
            ...option,
            end: {
              spotPriceUSD: endSpotPrice,
              askPremiumUSD: endPrice,
              bidPremiumUSD: endBidPrice,
              askIVPercent: endAskIV,
              indexIVPercent: endIndexIV,
              ...endGreeks,
            },
            optionPnlUSD,
            optionPnlPercent,
            expired: isExpired,
            closeDate: endTimestamp.toISOString(),
          };
        })
      );

      const pnlOptionsPercent = updatedOptions.reduce(
        (sum, option) => sum + option.optionPnlPercent,
        0
      );
      const pnlTotalPercent =
        pnlPercentLP + (pnlOptionsUSD / record.amountUSD) * 100;

      delete record.pnlPercent;

      // Separate options and trading results
      const optionsResult = {
        ...record,
        options: updatedOptions,
        pnlPercentLP,
        pnlOptionsUSD,
        pnlOptionsPercent,
        pnlTotalPercent,
      };

      const tradingResult = {
        ...record,
        tradingPositions: record.tradingPositions || [],
      };

      fileResults.push({
        options: optionsResult,
        trading: tradingResult,
      });
    }

    results.push({ file, results: fileResults });
  }

  return results;
}

async function main(inputPath, strategyPath, outputPath) {
  const data = readCSVFiles(inputPath);
  const strategies = JSON.parse(fs.readFileSync(strategyPath, "utf-8"));

  for (const strategy of strategies) {
    log(`Processing strategy: ${strategy.strategyName}`);
    const results = await processData(data, strategy);
    writeResults(results, strategy, outputPath);
  }
}

program
  .description("CLI tool for options-based LP position hedging simulation")
  .requiredOption("-i, --input <path>", "Input directory path")
  .requiredOption("-s, --strategy <path>", "Path to the strategy JSON file")
  .requiredOption("-o, --output <path>", "Output directory path")
  .action(async (options) => {
    try {
      await main(options.input, options.strategy, options.output);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  });

program.parse(process.argv);

function writeResults(results, strategy, outputPath) {
  // Create subdirectories for trades and options
  const tradesOutputDir = path.join(outputPath, "trades");
  const optionsOutputDir = path.join(outputPath, "options");

  [tradesOutputDir, optionsOutputDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  for (const { file, results: fileResults } of results) {
    let increment = 1;
    let outputFileName;
    let outputFilePath;

    do {
      outputFileName = `${strategy.strategyName}_${path.basename(
        file,
        ".csv"
      )}_${increment}.json`;
      outputFilePath = path.join(optionsOutputDir, outputFileName);
      increment++;
    } while (fs.existsSync(outputFilePath));

    // Write options results
    const optionsOutput = {
      strategy: strategy.name,
      originalFile: file,
      results: fileResults.map((result) => {
        const optionsResult = {...result.options};
        delete optionsResult.tradingPositions;
        return optionsResult;
      }),
    };
    fs.writeFileSync(outputFilePath, JSON.stringify(optionsOutput, null, 2));
    console.log(`Options results written to ${outputFilePath}`);

    // Write trading positions to CSV
    const tradingPositions = fileResults.flatMap((result) =>
      result.trading.tradingPositions.map((pos) => ({
        lpPositionId: pos.lpPositionId,
        type: pos.type,
        openTimestamp: new Date(pos.openTimestamp).toISOString(),
        closeTimestamp: new Date(pos.closeTimestamp).toISOString(),
        openPrice: pos.openPrice,
        closePrice: pos.closePrice,
        entryAmount: pos.entryAmount,
        pnlPercent: pos.pnlPercent,
        pnlUSD: pos.pnlUSD,
        closedBy: pos.closedBy,
      }))
    );

    if (tradingPositions.length > 0) {
      const tradesFileName = `${strategy.strategyName}_${path.basename(
        file,
        ".csv"
      )}_trades_${increment}.csv`;
      const tradesFilePath = path.join(tradesOutputDir, tradesFileName);

      const csvHeader = Object.keys(tradingPositions[0]).join(",") + "\n";
      const csvRows = tradingPositions
        .map((pos) => Object.values(pos).join(","))
        .join("\n");

      fs.writeFileSync(tradesFilePath, csvHeader + csvRows);
      console.log(`Trading results written to ${tradesFilePath}`);
    }
  }
}
