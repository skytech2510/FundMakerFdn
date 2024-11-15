import CONFIG from "#src/config.js";
import db from "#src/database.js";
import { pools, trades, liquidity, fee_tiers, spot, iv_hist } from "#src/schema.js";
import {
  queryPoolMetadata,
  queryPoolTrades,
  queryPoolLiquidity,
  queryPoolFeeTiers,
} from "#src/graphql.js";
import { getPoolMetadata, batchInsert } from "#src/db-utils.js";

export async function savePoolMetadata(poolType, pool) {
  try {
    const rows = await db
      .insert(pools)
      .values({
        token0Symbol: pool.token0.symbol,
        token1Symbol: pool.token1.symbol,
        token0Decimals: pool.token0.decimals,
        token1Decimals: pool.token1.decimals,
        type: poolType,
        address: pool.id,
        feeTier: CONFIG.DYNAMIC_FEE_POOLS.includes(poolType)
          ? null
          : pool.feeTier,
        created: pool.created * 1000,
      })
      .onConflictDoNothing()
      .returning();

    const row = rows[0];

    console.log(`Saved metadata for ${row.token0Symbol}/${row.token1Symbol}:`);

    return row.id;
  } catch (err) {
    console.error("Error saving pool metadata:", err.message);
    throw err;
  }
}

export async function saveTradesToDatabase(tradesData) {
  try {
    await batchInsert(db, trades, tradesData);
  } catch (err) {
    console.error("Error saving trades:", err.message);
    throw err;
  }
}

export async function saveLiquidityToDatabase(liquidityData) {
  try {
    await batchInsert(db, liquidity, liquidityData);
  } catch (err) {
    console.error("Error saving liquidity data:", err.message);
    throw err;
  }
}

export async function fetchPool(poolType, poolAddress) {
  let poolId = (await getPoolMetadata(poolType, poolAddress))?.id;

  if (!poolId) {
    console.log(`Fetching metadata for ${poolType} pool ${poolAddress}`);
    const poolMetadata = await queryPoolMetadata(poolType, poolAddress);
    if (poolMetadata) {
      poolId = await savePoolMetadata(poolType, poolMetadata);
      if (!poolId) {
        console.error(
          `Failed to save pool metadata for ${poolType} pool ${poolAddress}`
        );
        return;
      }
    }
  }
  return poolId;
}

export async function fetchDailyTrades(
  { poolType, poolId, poolAddress },
  startDate,
  endDate
) {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  const trades = await queryPoolTrades(
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    0
  );

  const formattedTrades = trades.map((trade) => {
    return {
      pool_id: poolId,
      txid: trade.id,
      timestamp: Number(trade.timestamp) * 1000,
      amount0: trade.amount0,
      amount1: trade.amount1,
      amountUSD: trade.amountUSD,
      sqrtPriceX96: trade.sqrtPriceX96,
      tick: trade.tick,
    };
  });

  await saveTradesToDatabase(formattedTrades, poolId);

  console.log(
    `Fetched ${
      trades.length
    } trades for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}

export async function fetchLiquidity(pool, startDate, endDate) {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);

  let liquidityData = await queryPoolLiquidity(
    pool.type,
    pool.address,
    startTimestamp,
    endTimestamp,
    0
  );
  liquidityData = liquidityData.map((liquidityPoint) => ({
    pool_id: pool.id,
    timestamp: parseInt(liquidityPoint.periodStartUnix * 1000),
    liquidity: liquidityPoint.liquidity,
  }));

  saveLiquidityToDatabase(liquidityData, pool.id);

  console.log(
    `Finished fetching liquidity for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}

export async function saveFeeTiersToDatabase(feeTiersData, poolId) {
  try {
    await batchInsert(db, fee_tiers, feeTiersData);
  } catch (err) {
    console.error("Error saving feeTiers data:", err.message);
    throw err;
  }
}

export async function fetchFeeTiers(pool, startDate, endDate) {
  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  const endTimestamp = Math.floor(endDate.getTime() / 1000);
  let feeTiersData = await queryPoolFeeTiers(
    pool.type,
    pool.address,
    startTimestamp,
    endTimestamp,
    0
  );
  feeTiersData = feeTiersData.map((hourFee) => ({
    ...hourFee,
    timestamp: Number(hourFee.timestamp) * 1000,
    pool_id: pool.id,
  }));
  saveFeeTiersToDatabase(feeTiersData, pool.id);
  console.log(
    `Finished fetching feeTiers for ${startDate.toISOString()} to ${endDate.toISOString()}`
  );
}

export async function fetchAndSaveSpotData(interval, startDate, endDate) {
  for (const symbol of CONFIG.SPOT_SYMBOLS) {
    const data = await scrapeData(symbol, interval, startDate, endDate);
    await saveToDatabase(data, symbol, interval);
  }
  console.log("Data fetching and saving completed");

  async function saveToDatabase(data, symbol, interval) {
    const rows = data.map((item) => ({
      symbol,
      interval,
      timestamp: parseInt(item[0]),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
    }));

    if (rows.length > 0) {
      await batchInsert(db, spot, rows);
      console.log(
        `Saved ${rows.length} records for ${symbol} (${interval}) to the database`
      );
    } else {
      console.log(`No valid records to save for ${symbol} (${interval})`);
    }
  }
}

export async function fetchAndSaveIVData(symbol, resolution, fromDate, toDate) {
  const from = Math.floor(new Date(fromDate).getTime() / 1000);
  const to = Math.floor(new Date(toDate).getTime() / 1000);
  
  const url = `${CONFIG.IV_API_URL}?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.s === "ok") {
      const rows = data.t.map((timestamp, index) => ({
        symbol,
        resolution,
        timestamp: timestamp * 1000, // Convert to milliseconds
        open: data.o[index],
        high: data.h[index],
        low: data.l[index],
        close: data.c[index],
      }));

      if (rows.length > 0) {
        await batchInsert(db, iv_hist, rows);
        console.log(
          `Saved ${rows.length} IV records for ${symbol} (resolution: ${resolution}) to the database`
        );
      } else {
        console.log(`No valid IV records to save for ${symbol} (resolution: ${resolution})`);
      }
    } else {
      console.error(`Error fetching IV data: ${data.s}`);
    }
  } catch (error) {
    console.error(`Error fetching or saving IV data:`, error);
  }
}

function formatDate(timestamp) {
  return new Date(timestamp).toISOString();
}

async function fetchData(symbol, interval, startTime, endTime) {
  const url = `${CONFIG.SPOT_API_URL}?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${CONFIG.SPOT_BATCH_SIZE}`;
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

async function scrapeData(symbol, interval, startDate, endDate) {
  let allData = [];
  let currentStartTime = new Date(startDate).getTime();
  const endTime = new Date(endDate).getTime();

  while (currentStartTime < endTime) {
    try {
      const data = await fetchData(symbol, interval, currentStartTime, endTime);

      if (data.length === 0) {
        break;
      } else {
        allData = allData.concat(data);
        currentStartTime = data[data.length - 1][0] + 1;
        console.log(
          `Fetched ${
            data.length
          } records for ${symbol}, new startTime: ${formatDate(
            currentStartTime
          )}, total: ${allData.length}`
        );
      }
    } catch (error) {
      console.error(`Error fetching data for ${symbol}:`, error);
      break;
    }
  }

  return allData;
}
