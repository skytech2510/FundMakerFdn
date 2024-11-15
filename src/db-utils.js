import db from "./database.js";
import {
  pools,
  trades,
  liquidity,
  fee_tiers,
  spot,
  iv_hist,
  volatility,
} from "./schema.js";
import { sql, and, eq, lte, between, gte, count, desc } from "drizzle-orm";
import { handle } from "./misc-utils.js";
import CONFIG from "./config.js";

export const getPoolMetadata = handle(async (poolType, poolAddress) => {
  const rows = await db
    .select()
    .from(pools)
    .where(and(eq(pools.type, poolType), eq(pools.address, poolAddress)))
    .limit(1);
  return rows[0];
}, "reading pool metadata");

export const getPrices = handle(async (poolId, timestamp) => {
  // Get price from a swap close to timestamp
  const rows = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.pool_id, poolId),
        gte(trades.amountUSD, CONFIG.SWAP_USD_THRESHOLD)
      )
    )
    .orderBy(sql`ABS(${trades.timestamp} - ${timestamp.getTime()})`) // Assuming timestamp is a Date object
    .limit(1);
  if (rows.length === 0) {
    throw new Error("Trades query returned no results - try fetching data");
  }
  const price0 = Math.abs(Number(rows[0].amountUSD) / Number(rows[0].amount0));
  const price1 = Math.abs(Number(rows[0].amountUSD) / Number(rows[0].amount1));
  const sqrtPriceX96 = rows[0].sqrtPriceX96;
  return { price0, price1, sqrtPriceX96 };
}, "reading price from DB");

export const getTableBetween = async (
  table,
  poolId,
  startTimestamp,
  endTimestamp
) => {
  const rows = await db
    .select()
    .from(table)
    .where(
      and(
        eq(table.pool_id, poolId),
        between(
          table.timestamp,
          startTimestamp.getTime(),
          endTimestamp.getTime()
        )
      )
    )
    .orderBy(table.timestamp);

  return rows;
};

export const getLiquidityBetween = handle(
  async (...args) => getTableBetween(liquidity, ...args),
  "fetching liquidity points between timestamps"
);
export const getFeeTiersBetween = handle(
  async (...args) => getTableBetween(fee_tiers, ...args),
  "fetching fee tiers between timestamps"
);

export const sumTradeVolume = handle(
  async (
    poolId,
    startTimestamp,
    endTimestamp,
    sqPriceX96Low = 0,
    sqPriceX96High = Infinity
  ) => {
    if (CONFIG.SHOW_SIMULATION_PROGRESS) process.stdout.write(".");
    const result = await db
      .select({ totalAmountUSD: sql`SUM(${trades.amountUSD})` })
      .from(trades)
      .where(
        and(
          eq(trades.pool_id, poolId),
          between(trades.timestamp, startTimestamp, endTimestamp),
          between(trades.sqrtPriceX96, sqPriceX96Low, sqPriceX96High)
        )
      );

    return result[0]?.totalAmountUSD || 0;
  },
  "summing volume"
);

export const processIntervals = handle(
  async (calc, pool, pos, sqPriceX96Low, sqPriceX96High) => {
    // Fetch liquidity timestamps between the start and end
    const liquiditySteps = await getLiquidityBetween(
      pool.id,
      pos.openTime,
      pos.closeTime
    );
    const feeTierSteps = await getFeeTiersBetween(
      pool.id,
      pos.openTime,
      pos.closeTime
    );

    if (liquiditySteps.length === 0) {
      throw new Error(
        "No liquidity steps found between the provided timestamps."
      );
    }

    // Initialize intervals, starting with the [pos.openTime, first liquidity] interval
    let intervals = [];

    // Add the first interval [pos.openTime, liquiditySteps[0].timestamp] only if it's valid
    if (liquiditySteps[0].timestamp > pos.openTime) {
      intervals.push({
        start: pos.openTime.getTime(),
        end: liquiditySteps[0].timestamp,
      });
    }

    // Add the rest of the intervals
    for (let i = 0; i < liquiditySteps.length - 1; i++) {
      intervals.push({
        start: liquiditySteps[i].timestamp,
        end: liquiditySteps[i + 1].timestamp,
      });
    }

    // Add the last interval [last liquidity timestamp, pos.closeTime] if it's valid
    if (liquiditySteps[liquiditySteps.length - 1].timestamp < pos.closeTime) {
      intervals.push({
        start: liquiditySteps[liquiditySteps.length - 1].timestamp,
        end: pos.closeTime.getTime(),
      });
    }

    const hourlyReturns = [];

    // Process each interval
    for (const interval of intervals) {
      // Sum the trade volume in this interval
      const volume = await sumTradeVolume(
        pool.id,
        interval.start,
        interval.end,
        sqPriceX96Low,
        sqPriceX96High
      );

      if (!volume) continue;

      const intervalLiq = liquiditySteps.find(
        (liq) => liq.timestamp === interval.start
      )?.liquidity;

      let intervalFeeTier;
      if (CONFIG.DYNAMIC_FEE_POOLS.includes(pool.type)) {
        intervalFeeTier = feeTierSteps.find(
          (row) => row.timestamp === interval.start
        )?.feeTier;
      } else {
        intervalFeeTier = pool.feeTier;
      }

      if (intervalLiq != null && volume != null) {
        hourlyReturns.push(calc(intervalLiq, volume, intervalFeeTier));
      }
    }

    return hourlyReturns;
  },
  "processing intervals"
);

export async function batchInsert(db, table, items, chunkSize = 999) {
  for (let i = 0; i < items.length; i += chunkSize) {
    await db
      .insert(table)
      .values(items.slice(i, i + chunkSize))
      .onConflictDoNothing();
  }
}

export async function checkLiquidityIntegrity(poolId, startDate, endDate) {
  const startTimestamp = Math.floor(new Date(startDate).getTime());
  const endTimestamp = Math.floor(new Date(endDate).getTime());

  // Calculate the number of hours between start and end dates
  const hoursBetween =
    Math.floor((endTimestamp - startTimestamp) / 3600000) - 1;

  // Count liquidity datapoints using Drizzle ORM
  const result = await db
    .select({ datapoint_count: count() })
    .from(liquidity)
    .where(
      and(
        eq(liquidity.pool_id, poolId),
        gte(liquidity.timestamp, startTimestamp),
        lte(liquidity.timestamp, endTimestamp)
      )
    )
    .execute();

  const datapointCount = result[0].datapoint_count;

  // Compare datapoint count with the number of hours
  return datapointCount >= hoursBetween;
}

export function getAllTrades(pool_id, startDate, endDate) {
  // Convert JavaScript Date objects to Unix timestamps
  const startTimestamp = startDate.getTime();
  const endTimestamp = endDate.getTime();

  // Raw SQL query with dynamic filtering
  const query = sql`
    SELECT 
        t.*, 
        l.liquidity AS current_liquidity, 
        f.feeTier AS current_feeTier
    FROM 
        ${trades} t
    LEFT JOIN 
        ${liquidity} l ON t.pool_id = l.pool_id 
        AND l.timestamp = (
            SELECT MAX(l2.timestamp)
            FROM ${liquidity} l2
            WHERE l2.pool_id = t.pool_id 
            AND l2.timestamp <= t.timestamp
        )
    LEFT JOIN 
        ${fee_tiers} f ON t.pool_id = f.pool_id 
        AND f.timestamp = (
            SELECT MAX(f2.timestamp)
            FROM ${fee_tiers} f2
            WHERE f2.pool_id = t.pool_id 
            AND f2.timestamp <= t.timestamp
        )
    WHERE 
        t.pool_id = ${pool_id}
        AND t.timestamp BETWEEN ${startTimestamp} AND ${endTimestamp}
  `;

  // Execute the query and return the results
  const res = db.all(query);
  return res;
}

export const getPoolById = handle(async (poolId) => {
  const rows = await db
    .select()
    .from(pools)
    .where(eq(pools.id, poolId))
    .limit(1);
  return rows[0];
}, "getting pool by id");

export const getFirstSpotPrice = handle(async (symbol, timestamp) => {
  const targetTimestamp = new Date(timestamp).getTime();
  const result = await db
    .select()
    .from(spot)
    .where(and(eq(spot.symbol, symbol), lte(spot.timestamp, targetTimestamp)))
    .orderBy(desc(spot.timestamp))
    .limit(1)
    .execute();

  if (result.length > 0) {
    const timeDiff = Math.abs(targetTimestamp - result[0].timestamp);
    return timeDiff <= CONFIG.MAX_SPOT_TIMEDIST ? result[0].close : null;
  }
  return null;
}, "getting first spot price");

export const filterFirstSpotPrice = handle(
  async (price, isGreater, symbol, timestampFrom) => {
    const targetTimestamp = new Date(timestampFrom).getTime();
    const result = await db
      .select()
      .from(spot)
      .where(
        and(
          eq(spot.symbol, symbol),
          gte(spot.timestamp, targetTimestamp),
          isGreater ? gte(spot.close, price) : lte(spot.close, price)
        )
      )
      .orderBy(spot.timestamp)
      .limit(1)
      .execute();

    return result.length > 0 ? result[0] : null;
  },
  "finding first spot price crossing"
);

export const getHistIV = handle(async (symbol, timestamp) => {
  const result = await db
    .select()
    .from(iv_hist)
    .where(
      and(
        eq(iv_hist.symbol, symbol),
        lte(iv_hist.timestamp, new Date(timestamp).getTime())
      )
    )
    .orderBy(desc(iv_hist.timestamp))
    .limit(1)
    .execute();

  return result.length > 0 ? result[0].close : null;
}, "getting historical implied volatility");

export const getRealizedVolatility = handle(async (poolId, timestamp) => {
  const result = await db
    .select()
    .from(volatility)
    .where(
      and(eq(volatility.pool_id, poolId), lte(volatility.timestamp, timestamp))
    )
    .orderBy(desc(volatility.timestamp))
    .limit(1)
    .execute();

  return result.length > 0 ? result[0].realizedVolatility : null;
}, "getting realized volatility");

export const getLatestDatapoint = handle(async (table, poolId, timestamp) => {
  const result = await db
    .select()
    .from(table)
    .where(and(eq(table.pool_id, poolId), lte(table.timestamp, timestamp)))
    .orderBy(desc(table.timestamp))
    .limit(1)
    .execute();

  return result.length > 0 ? result[0] : null;
}, "getting latest datapoint");
