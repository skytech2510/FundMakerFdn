import db from "#src/database.js";
import { trades, volatility, pools } from "#src/schema.js";
import { and, eq, between } from "drizzle-orm";
import { decodePrice, calculateStandardDeviation } from "#src/pool-math.js";
import { batchInsert } from "#src/db-utils.js";

export async function calcRealizedVolatility(pool_id, startDate, endDate) {
  const startTimestamp = Math.floor(startDate.getTime());
  const endTimestamp = Math.floor(endDate.getTime());

  const res = await db.select().from(pools).where(eq(pools.id, pool_id));
  const pool = res[0];

  const tradeData = await db
    .select({
      sqrtPriceX96: trades.sqrtPriceX96,
      timestamp: trades.timestamp,
    })
    .from(trades)
    .where(
      and(
        eq(trades.pool_id, pool_id),
        between(trades.timestamp, startTimestamp, endTimestamp)
      )
    )
    .orderBy(trades.timestamp)
    .execute();

  if (tradeData.length < 2) {
    return 0;
    // throw new Error(
    //   "Insufficient trade data found for the specified pool and time period."
    // );
  }

  // Sample at 5-minute intervals
  const intervalMs = 5 * 60 * 1000;
  const sampledData = [];
  let currentInterval = startTimestamp;

  for (const trade of tradeData) {
    if (trade.timestamp >= currentInterval) {
      sampledData.push(trade);
      currentInterval += intervalMs;
    }
  }

  const logReturns = [];
  for (let i = 1; i < sampledData.length; i++) {
    const price_t = decodePrice(sampledData[i].sqrtPriceX96, pool);
    const price_t_1 = decodePrice(sampledData[i - 1].sqrtPriceX96, pool);
    const logReturn = Math.log(price_t / price_t_1);
    logReturns.push(logReturn);
  }

  const standardDeviation = calculateStandardDeviation(logReturns);

  // Annualize the volatility (sqrt of time scaling)
  const timeSpanInYears =
    (endTimestamp - startTimestamp) / (365 * 24 * 60 * 60 * 1000);
  const annualizedVolatility =
    standardDeviation * Math.sqrt(1 / timeSpanInYears);

  // Convert to percentage
  return annualizedVolatility * 100;
}

export async function rollingRealizedVolatility(
  pool_id,
  startDate,
  endDate,
  intervalSize = 600000,
  windowSize = 3600000,
  batchSize = 4320
) {
  const startTimestamp = Math.floor(startDate.getTime());
  const endTimestamp = Math.floor(endDate.getTime());
  let batch = [];

  for (
    let currentEnd = endTimestamp;
    currentEnd >= startTimestamp + windowSize;
    currentEnd -= intervalSize
  ) {
    const windowStart = new Date(currentEnd - windowSize);
    const windowEnd = new Date(currentEnd);
    try {
      const volatilityValue =
        (await calcRealizedVolatility(pool_id, windowStart, windowEnd)) || 0;

      batch.push({
        pool_id: pool_id,
        timestamp: currentEnd,
        realizedVolatility: volatilityValue.toString(),
      });

      // When the batch reaches the specified size, insert it and reset
      if (batch.length >= batchSize) {
        await batchInsert(db, volatility, batch);
        batch = [];
      }
    } catch (error) {
      console.error(
        `Error calculating volatility for pool ${pool_id} at timestamp ${currentEnd}: ${error.message}`
      );
    }
  }

  // Insert any remaining items in the batch
  if (batch.length > 0) {
    await batchInsert(db, volatility, batch);
  }
}
