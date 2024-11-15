import fs from "fs";
import path from "path";
import { program } from "commander";
import { parse, format } from "fast-csv";
import { simulateLP } from "#src/simulate.js";
import db from "#src/database.js";
import { trades } from "#src/schema.js";
import { getHistIV } from "#src/db-utils.js";
import {
  checkLiquidityIntegrity,
  getPoolById,
  getPoolMetadata,
  getLatestDatapoint,
} from "#src/db-utils.js";
import { fetchData } from "#src/fetcher.js";
import CONFIG from "#src/config.js";
import { decodePrice, calculateStandardDeviation } from "#src/pool-math.js";
import { fetchPool } from "#src/fetch-utils.js";

// Function to read CSV file using fast-csv
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rowsCSV = [];
    fs.createReadStream(filePath)
      .pipe(parse({ headers: true }))
      .on("data", (row) => rowsCSV.push(row))
      .on("error", (err) => {
        reject(`Error reading file ${filePath}: ${err}`);
      })
      .on("end", () => {
        resolve(rowsCSV);
      });
  });
}

async function getLatestIV(timestamp) {
  return await getHistIV("EVIV", timestamp);
}

async function executeStrategy(db, pool, startDate, endDate, strategy) {
  let lpPositionId = 1;
  let positions = [];
  let currentDate = new Date(startDate);
  const endDateTime = new Date(endDate).getTime();
  let openPositions = [];

  while (currentDate.getTime() <= endDateTime) {
    // Check for position closure first
    for (const hour of strategy.hoursCheckClose) {
      const closeCheckTime = new Date(currentDate);
      closeCheckTime.setUTCHours(hour, 0, 0, 0);

      if (closeCheckTime.getTime() > endDateTime) break;

      openPositions = openPositions.filter((position) => {
        const positionAge = closeCheckTime.getTime() - position.openTimestamp;
        const maxPositionAge = strategy.positionOpenDays * 24 * 60 * 60 * 1000;

        if (positionAge >= maxPositionAge) {
          position.closeTimestamp = closeCheckTime.getTime();
          positions.push(position);
          return false;
        }
        return true;
      });
    }

    // Check for opening new positions
    for (const hour of strategy.hoursCheckOpen) {
      const checkTime = new Date(currentDate);
      checkTime.setUTCHours(hour, 0, 0, 0);

      if (checkTime.getTime() > endDateTime) break;

      // Check if we should open a new position based on onePosPerPool
      if (strategy.onePosPerPool && openPositions.length > 0) {
        const lastOpenPosition = openPositions[openPositions.length - 1];
        const timeSinceLastOpen =
          checkTime.getTime() - lastOpenPosition.openTimestamp;
        const maxPositionAge = strategy.positionOpenDays * 24 * 60 * 60 * 1000;

        if (timeSinceLastOpen < maxPositionAge) {
          //console.log("Skipping new position due to onePosPerPool strategy");
          continue;
        }
      }

      const ivData = await getLatestIV(checkTime.getTime());

      if (ivData && parseFloat(ivData) > strategy.volatilityThreshold) {
        console.log("Entering position, IV:", ivData);
        const tradeData = await getLatestDatapoint(
          trades,
          pool.id,
          checkTime.getTime()
        );

        if (tradeData) {
          const openPrice = parseFloat(
            decodePrice(tradeData.sqrtPriceX96, pool)
          );
          const newPosition = {
            openTimestamp: checkTime.getTime(),
            openPrice: openPrice,
            targetUptickPrice:
              openPrice * (1 + strategy.priceRange.uptickPercent / 100),
            targetDowntickPrice:
              openPrice * (1 - strategy.priceRange.downtickPercent / 100),
            closeTimestamp: null,
          };
          openPositions.push(newPosition);
        }
      }
    }

    currentDate.setUTCDate(currentDate.getDate() + 1);
  }

  // Close any remaining open positions
  for (let position of openPositions) {
    position.closeTimestamp = endDateTime;
    positions.push(position);
  }

  let allLPPositions = [];
  let allTradingPositions = [];

  for (let position of positions) {
    const simulationResults = await simulateLP({
      lpPositionId: lpPositionId++,
      poolType: pool.type,
      poolAddress: pool.address,
      openTime: new Date(position.openTimestamp),
      closeTime: new Date(position.closeTimestamp),
      priceRange: strategy?.priceRange,
      rebalance: strategy?.rebalance,
      fullRange: strategy?.priceRange?.fullRange,
      amountUSD: strategy.amountUSD || CONFIG.DEFAULT_POS_USD,
      positionOpenDays: strategy.positionOpenDays,
      trading: strategy.trading,
      amountUSD: strategy.amountUSD || CONFIG.DEFAULT_POS_USD,
    });

    if (simulationResults) {
      allLPPositions.push(simulationResults.lpPositions);
      if (simulationResults.tradingPositions) {
        allTradingPositions = allTradingPositions.concat(
          simulationResults.tradingPositions
        );
      }
    }
  }

  return {
    lpPositions: allLPPositions,
    tradingPositions: allTradingPositions,
  };
}

// Writing CSV output using fast-csv
async function writeOutputCSV(results, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }


  for (const result of results) {
    const { strategyName, poolType, poolAddress, lpPositions } = result;
    const pool = await getPoolMetadata(poolType, poolAddress);
    const token0 = pool.token0Symbol;
    const token1 = pool.token1Symbol;

    // Write LP positions
    let increment = 1;
    let fileName;
    let filePath;

    do {
      fileName = `${strategyName}_${token0}${token1}_${pool.id}_${poolType}_${increment}.csv`;
      filePath = path.join(outputDir, fileName); // Write directly to output directory
      increment++;
    } while (fs.existsSync(filePath));

    const csvStream = format({ headers: true });
    const writableStream = fs.createWriteStream(filePath);

    csvStream.pipe(writableStream);

    lpPositions.forEach((positionSet) => {
      positionSet.forEach((position) => {
        csvStream.write({
          lpPositionId: position.lpPositionId,
          poolType: position.poolType,
          poolAddress: position.poolAddress,
          openTimestamp: new Date(position.openTimestamp).toISOString(),
          closeTimestamp: new Date(position.closeTimestamp).toISOString(),
          openPrice: position.openPrice,
          closePrice: position.closePrice,
          amountUSD: position.amountUSD,
          feesCollected: position.feesCollected,
          ILPercentage: position.ILPercentage,
          pnlPercent: position.pnlPercent,
        });
      });
    });

    csvStream.end();

    console.log(`Results written to ${filePath}`);

    // Add separate CSV writing for trading positions
    if (result.tradingPositions.length > 0) {
      let increment = 1;
      let fileName;
      let filePath;

      do {
        fileName = `${result.strategyName}_${token0}${token1}_${pool.id}_trades_${increment}.csv`;
        filePath = path.join(tradesOutputDir, fileName);
        increment++;
      } while (fs.existsSync(filePath));

      const csvStream = format({ headers: true });
      const writableStream = fs.createWriteStream(filePath);

      csvStream.pipe(writableStream);

      result.tradingPositions.forEach((trade) => {
        csvStream.write({
          lpPositionId: trade.lpPositionId,
          type: trade.type,
          openTimestamp: new Date(trade.openTimestamp).toISOString(),
          closeTimestamp: new Date(trade.closeTimestamp).toISOString(),
          openPrice: trade.openPrice,
          closePrice: trade.closePrice,
          entryAmount: trade.entryAmount,
          entryPricePercent: trade.strategyConfig?.entryPricePercent,
          takeProfitPercent: trade.strategyConfig?.takeProfitPercent,
          stopLossPercent: trade.strategyConfig?.stopLossPercent,
          pnlPercent: trade.pnlPercent,
          pnlUSD: trade.pnlUSD,
          closedBy: trade.closedBy,
        });
      });

      csvStream.end();
      console.log(`Trade results written to ${filePath}`);
    }
  }
}

async function main(opts) {
  const strategyJSON = JSON.parse(fs.readFileSync(opts.strategy, "utf8"));
  const poolsCSV = await parseCSV(opts.input);

  const results = [];

  for (const strategy of strategyJSON) {
    console.log(`Executing strategy "${strategy.strategyName}"`);
    for (const poolRow of poolsCSV) {
      if (!poolRow.poolType) continue; // empty line
      console.log("Pool", poolRow.poolType, poolRow.poolAddress);
      const poolId = await fetchPool(poolRow.poolType, poolRow.poolAddress);
      const pool = await getPoolById(poolId);

      const startDate = poolRow.startDate
        ? new Date(poolRow.startDate)
        : new Date(pool.created);
      const endDate = poolRow.endDate ? new Date(poolRow.endDate) : new Date();

      if (opts.checks) {
        console.log("Checking data integrity...");
        let didFetch;
        if (endDate !== null) {
          didFetch = await checkLiquidityIntegrity(poolId, startDate, endDate);
        } else didFetch = false;
        if (!didFetch) {
          console.log("Fetching the data...");
          await fetchData({ ...poolRow, poolId, startDate, endDate });
        }
      }

      const { lpPositions, tradingPositions } = await executeStrategy(
        db,
        pool,
        startDate,
        endDate,
        strategy
      );

      // Calculate LP statistics
      const lpPnlArr = lpPositions.flat().map((p) => p.pnlPercent);
      const lpAvgPnL = lpPnlArr.length
        ? lpPnlArr.reduce((a, r) => a + (r || 0), 0) / lpPnlArr.length
        : 0;
      const lpStd = calculateStandardDeviation(
        lpPnlArr.filter((x) => !isNaN(x))
      );
      const lpSharpe = lpStd !== 0 ? lpAvgPnL / lpStd : 0;

      // Calculate trading statistics by position type
      const longPositions = tradingPositions.filter((t) => t.type === "long");
      const shortPositions = tradingPositions.filter((t) => t.type === "short");

      // Long positions stats
      const longPnlArr = longPositions.map((t) => t.pnlPercent);
      const longTotalPnLUSD = longPositions.reduce(
        (sum, t) => sum + (t.pnlUSD || 0),
        0
      );
      const longAvgPnL = longPnlArr.length
        ? longPnlArr.reduce((a, r) => a + (r || 0), 0) / longPnlArr.length
        : 0;
      const longStd = calculateStandardDeviation(
        longPnlArr.filter((x) => !isNaN(x))
      );
      const longSharpe = longStd !== 0 ? longAvgPnL / longStd : 0;

      // Short positions stats
      const shortPnlArr = shortPositions.map((t) => t.pnlPercent);
      const shortTotalPnLUSD = shortPositions.reduce(
        (sum, t) => sum + (t.pnlUSD || 0),
        0
      );
      const shortAvgPnL = shortPnlArr.length
        ? shortPnlArr.reduce((a, r) => a + (r || 0), 0) / shortPnlArr.length
        : 0;
      const shortStd = calculateStandardDeviation(
        shortPnlArr.filter((x) => !isNaN(x))
      );
      const shortSharpe = shortStd !== 0 ? shortAvgPnL / shortStd : 0;

      // Combined trading statistics
      const totalTradingPnLUSD = longTotalPnLUSD + shortTotalPnLUSD;
      const totalTradingPnLPercent = tradingPositions.length
        ? (totalTradingPnLUSD /
            (strategy.amountUSD || CONFIG.DEFAULT_POS_USD)) *
          100
        : 0;

      results.push({
        strategyName: strategy.strategyName,
        poolType: poolRow.poolType,
        poolAddress: poolRow.poolAddress,
        lpPositions: lpPositions,
        tradingPositions: tradingPositions,
        lpStats: {
          avgPnL: lpAvgPnL,
          sharpe: lpSharpe,
        },
        tradeStats: {
          total: {
            pnlUSD: totalTradingPnLUSD,
            pnlPercent: totalTradingPnLPercent,
          },
          long: {
            count: longPositions.length,
            avgPnL: longAvgPnL,
            totalPnLUSD: longTotalPnLUSD,
            sharpe: longSharpe,
          },
          short: {
            count: shortPositions.length,
            avgPnL: shortAvgPnL,
            totalPnLUSD: shortTotalPnLUSD,
            sharpe: shortSharpe,
          },
        },
      });
    }
  }

  // Write results to output CSVs using fast-csv
  await writeOutputCSV(results, opts.output);

  // Log summary statistics with corrected trading metrics
  results.forEach((result) => {
    console.log(
      `Strategy: ${result.strategyName}, Pool: ${result.poolAddress}`
    );
    console.log("LP Positions:", result.lpPositions.length);
    console.log("LP Average PnL %:", result.lpStats.avgPnL.toFixed(2));
    console.log("LP Sharpe ratio:", result.lpStats.sharpe.toFixed(2));
    
    // Only show trading statistics if there were any trades
    if (result.tradingPositions && result.tradingPositions.length > 0) {
      console.log("\nTrading Statistics:");
      console.log("Long Positions:", result.tradeStats.long.count);
      console.log("  Average PnL %:", result.tradeStats.long.avgPnL.toFixed(2));
      console.log(
        "  Total PnL USD:",
        result.tradeStats.long.totalPnLUSD.toFixed(2)
      );
      console.log("  Sharpe Ratio:", result.tradeStats.long.sharpe.toFixed(2));
      console.log("Short Positions:", result.tradeStats.short.count);
      console.log("  Average PnL %:", result.tradeStats.short.avgPnL.toFixed(2));
      console.log(
        "  Total PnL USD:",
        result.tradeStats.short.totalPnLUSD.toFixed(2)
      );
      console.log("  Sharpe Ratio:", result.tradeStats.short.sharpe.toFixed(2));
      console.log("Combined Trading:");
      console.log("  Total PnL USD:", result.tradeStats.total.pnlUSD.toFixed(2));
      console.log(
        "  Total PnL %:",
        result.tradeStats.total.pnlPercent.toFixed(2)
      );
    }
    console.log("---");
  });
}

program
  .description(
    "Execute a strategy based on pools from the CSV file in the format of (poolType,poolAddress,startDate,endDate), and write output CSVs with position history."
  )
  .requiredOption("-i, --input <inputCSV>", "input CSV filename")
  .requiredOption("-s, --strategy <strategyJSON>", "strategy JSON filename")
  .option("-o, --output <outputDir>", "output directory", "output/")
  .option("-n, --no-checks", "disable data integrity check & autofetching")
  .action(main);

program.parse(process.argv);
