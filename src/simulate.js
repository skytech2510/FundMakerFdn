import CONFIG from "./config.js";
import {
  decodePrice,
  getTokensAmountFromDepositAmountUSD,
  getLiquidityDelta,
  estimateFee,
  calculateIL,
  PRICE_MIN,
  PRICE_MAX,
} from "./pool-math.js";
import { getPrices, getPoolMetadata, getAllTrades } from "./db-utils.js";
import bn from "bignumber.js";
import { incPercent, decPercent, mm } from "./misc-utils.js";

async function getDecodedPrices(pool, timestamp) {
  const prices = await getPrices(pool.id, timestamp);
  const price = decodePrice(prices.sqrtPriceX96, pool);
  return {
    ...prices,
    price,
  };
}

const log = (...args) => CONFIG.VERBOSE && console.log(...args);

function printPosition(pool, [amount0, amount1]) {
  log(`Position ${pool.token0Symbol}: ${amount0}`);
  log(`Position ${pool.token1Symbol}: ${amount1}`);
}

function calcPrices(trade) {
  return {
    ...trade,
    price0: Math.abs(+trade.amountUSD / +trade.amount0),
    price1: Math.abs(+trade.amountUSD / +trade.amount1),
  };
}

function calculatePriceRange(currentPrice, pos) {
  let price = {};
  if (pos.fullRange) {
    price = {
      high: PRICE_MAX,
      low: PRICE_MIN,
    };
  } else {
    price = {
      high: incPercent(currentPrice, pos.priceRange.uptickPercent),
      low: decPercent(currentPrice, pos.priceRange.downtickPercent),
    };
  }
  let rebalance = { high: PRICE_MAX, low: PRICE_MIN };
  if (pos.rebalance) {
    rebalance = {
      high: incPercent(currentPrice, pos.rebalance.uptickPercent),
      low: decPercent(currentPrice, pos.rebalance.downtickPercent),
    };
  }
  return {
    price,
    rebalance,
  };
}

export async function simulateLP(posConfig) {
  if (!posConfig.amountUSD) posConfig.amountUSD = CONFIG.DEFAULT_POS_USD;
  const p = true ? (p) => 1 / p : (p) => p;
  let pool, open, close;

  try {
    pool = await getPoolMetadata(posConfig.poolType, posConfig.poolAddress);
    open = await getDecodedPrices(pool, posConfig.openTime);
    close = await getDecodedPrices(pool, posConfig.closeTime);
  } catch (err) {
    console.error("Failed to read local DB, please fetch the data");
    log(err);
    return null;
  }

  let currentRange = calculatePriceRange(open.price, posConfig);

  log("Position value (USD):", posConfig.amountUSD);
  log("Entry price:", p(open.price));
  log(
    "Price low, high:",
    ...mm(p(currentRange.price.high), p(currentRange.price.low))
  );
  log(
    "Rebalance low, high:",
    ...mm(p(currentRange.rebalance.low), p(currentRange.rebalance.high))
  );
  log("Token prices at open:", open.price0, open.price1);

  // Calculate initial position
  let pos = getTokensAmountFromDepositAmountUSD(
    open.price,
    currentRange.price.low,
    currentRange.price.high,
    open.price0,
    open.price1,
    posConfig.amountUSD
  );
  printPosition(pool, [pos.amount0, pos.amount1]);

  log("Calculating fees");

  // Fetch all trades within the interval
  const trades = getAllTrades(pool.id, posConfig.openTime, posConfig.closeTime);
  log(`Simulating ${trades.length} trades...`);

  let positions = [];
  let currentPosition = {
    lpPositionId: posConfig.lpPositionId,
    poolType: posConfig.poolType,
    poolAddress: posConfig.poolAddress,
    openTimestamp: posConfig.openTime.getTime(),
    openPrice: open.price,
    amountUSD: posConfig.amountUSD,
    feesCollected: 0,
  };

  let inPriceRange = true;
  let lastTradeTimestamp = 0;

  for (let trade of trades) {
    if (trade.timestamp >= posConfig.closeTime.getTime()) {
      break; // Stop if we've reached or passed the strategy end timestamp
    }

    trade = calcPrices(trade);
    const volumeUSD = new bn(trade.amountUSD);
    if (!trade.amount0 || !trade.amount1) continue;

    const tradePrice = decodePrice(trade.sqrtPriceX96, pool);

    // Prevent creating positions with the same timestamp
    if (trade.timestamp <= lastTradeTimestamp) {
      continue;
    }
    lastTradeTimestamp = trade.timestamp;

    if (posConfig.rebalance) {
      if (
        tradePrice < currentRange.rebalance.low ||
        tradePrice > currentRange.rebalance.high
      ) {
        log("REBALANCING", currentRange, tradePrice);

        // Close current position
        currentPosition.closeTimestamp = trade.timestamp;
        currentPosition.closePrice = tradePrice;
        const { totalValueB: newValueUSD, ILPercentage } = calculateIL(
          [trade.price0, trade.price1],
          mm(1 / currentRange.price.low, 1 / currentRange.price.high),
          pos.liquidityDelta,
          pos.amount0,
          pos.amount1
        );
        currentPosition.ILPercentage = ILPercentage;
        currentPosition.pnlPercent =
          (newValueUSD / currentPosition.amountUSD - 1) * 100;
        positions.push(currentPosition);

        // Open new position
        currentRange = calculatePriceRange(tradePrice, posConfig);
        pos = getTokensAmountFromDepositAmountUSD(
          tradePrice,
          currentRange.price.low,
          currentRange.price.high,
          trade.price0,
          trade.price1,
          posConfig.amountUSD
        );
        currentPosition = {
          lpPositionId: posConfig.lpPositionId,
          poolType: posConfig.poolType,
          poolAddress: posConfig.poolAddress,
          openTimestamp: trade.timestamp,
          openPrice: tradePrice,
          amountUSD: posConfig.amountUSD,
          feesCollected: 0,
        };
        inPriceRange = true;
      }
    }

    if (
      tradePrice < currentRange.price.low ||
      tradePrice > currentRange.price.high
    ) {
      if (inPriceRange) {
        log("OUT OF RANGE:", tradePrice, pos.amount0, pos.amount1);
        inPriceRange = false;
      }
    } else {
      if (!inPriceRange) {
        log("IN RANGE:", tradePrice, pos.amount0, pos.amount1);
        inPriceRange = true;
      }

      const deltaL = getLiquidityDelta(
        tradePrice,
        currentRange.price.low,
        currentRange.price.high,
        pos.amount0,
        pos.amount1,
        pool.token0Decimals,
        pool.token1Decimals
      );

      const fee = estimateFee(
        deltaL,
        trade.current_liquidity,
        volumeUSD,
        trade.current_feeTier || pool.feeTier
      );

      if (!isNaN(fee)) {
        currentPosition.feesCollected += fee;
      }
    }
  }

  // Close the last position if it's still open
  if (currentPosition.closeTimestamp === undefined) {
    currentPosition.closeTimestamp = posConfig.closeTime.getTime();
    currentPosition.closePrice = close.price;
    const { totalValueB: newValueUSD, ILPercentage } = calculateIL(
      [close.price0, close.price1],
      mm(1 / currentRange.price.low, 1 / currentRange.price.high),
      pos.liquidityDelta,
      pos.amount0,
      pos.amount1
    );
    currentPosition.ILPercentage = ILPercentage;
    currentPosition.pnlPercent =
      (newValueUSD / currentPosition.amountUSD - 1) * 100;
    positions.push(currentPosition);
  }

  // If trading strategies are configured, simulate trading positions
  if (
    posConfig.trading &&
    Array.isArray(posConfig.trading) &&
    posConfig.trading.length > 0
  ) {
    const tradingPositions = await simulateTrading(
      trades,
      posConfig,
      currentPosition,
      pool,
      posConfig.lpPositionId
    );

    if (CONFIG.SHOW_SIMULATION_PROGRESS) log("");
    log("LP Positions:", positions.length);
    log("Trading Positions:", tradingPositions.length);

    // Log positions separately
    positions.forEach((pos, index) => {
      log(`LP Position ${index + 1}:`);
      logLPPosition(pos);
    });

    tradingPositions.forEach((pos, index) => {
      log(`Trading Position ${index + 1}:`);
      logTradingPosition(pos);
    });

    return {
      lpPositions: positions,
      tradingPositions,
    };
  }

  // If no trading strategies configured, just return LP positions
  return {
    lpPositions: positions,
    tradingPositions: [],
  };
}

// Helper function to reduce code duplication
function logLPPosition(pos) {
  log("  LP Position ID:", pos.id);
  log("  Open timestamp:", new Date(pos.openTimestamp).toISOString());
  log("  Close timestamp:", new Date(pos.closeTimestamp).toISOString());
  log("  Price:", pos.openPrice || pos.price);

  log("  Fees collected (USD):", pos.feesCollected);
  log("  IL (%):", pos.ILPercentage);
  log("  PnL (%):", pos.pnlPercent);

  log("-------------------");
}

//simulateLP(CONFIG.position);

function shouldClosePosition(position, currentPrice, strategy) {
  const takeProfitPrice =
    position.entryPrice * (1 + strategy.takeProfitPercent / 100);

  // Check take profit
  if (strategy.positionType === "long" && currentPrice >= takeProfitPrice) {
    return "takeProfit";
  }
  if (strategy.positionType === "short" && currentPrice <= takeProfitPrice) {
    return "takeProfit";
  }

  // Check stop loss if configured
  if (strategy.stopLossPercent) {
    const stopLossPrice =
      strategy.positionType === "long"
        ? position.entryPrice * (1 - Math.abs(strategy.stopLossPercent) / 100)
        : position.entryPrice * (1 + Math.abs(strategy.stopLossPercent) / 100);

    if (strategy.positionType === "long" && currentPrice <= stopLossPrice) {
      return "stopLoss";
    }
    if (strategy.positionType === "short" && currentPrice >= stopLossPrice) {
      return "stopLoss";
    }
  }

  return false;
}

function calculatePnL(position, currentPrice) {
  const pnlPercent =
    position.type === "long"
      ? (currentPrice / position.entryPrice - 1) * 100
      : (position.entryPrice / currentPrice - 1) * 100;

  const exitAmount = position.entryAmount * (1 + pnlPercent / 100);

  return {
    pnlPercent,
    pnlUSD: exitAmount - position.entryAmount,
  };
}

function shouldOpenPosition(strategy, currentPrice, lpEntryPrice) {
  // Calculate entry target relative to LP entry price
  const entryPriceTarget =
    lpEntryPrice * (1 + strategy.entryPricePercent / 100);

  if (strategy.positionType === "long") {
    // For long positions, current price should be above target
    return currentPrice >= entryPriceTarget;
  } else {
    // For short positions, current price should be below target
    return currentPrice <= entryPriceTarget;
  }
}

export async function simulateTrading(
  trades,
  posConfig,
  initialPosition,
  pool,
  lpPositionId
) {
  if (!trades.length || !posConfig.trading?.length) {
    return [];
  }

  const positions = [];
  // Use LP position entry price as reference
  const lpEntryPrice = initialPosition.openPrice;
  let currentPositions = {};

  // Initialize position tracking
  posConfig.trading.forEach((strategy) => {
    currentPositions[`${strategy.positionType}_${strategy.entryPricePercent}`] =
      null;
  });

  // Process each trade
  for (const trade of trades) {
    if (trade.amountUSD < CONFIG.MIN_TRADE_USD) continue;

    const currentPrice = decodePrice(trade.sqrtPriceX96, pool);

    // Check existing positions for closure
    for (const strategy of posConfig.trading) {
      const posKey = `${strategy.positionType}_${strategy.entryPricePercent}`;
      const position = currentPositions[posKey];

      if (!position) continue;

      const closeReason = shouldClosePosition(position, currentPrice, strategy);
      if (closeReason) {
        const { pnlPercent, pnlUSD } = calculatePnL(position, currentPrice);

        positions.push({
          ...position,
          closeTimestamp: trade.timestamp,
          closePrice: currentPrice,
          pnlPercent,
          pnlUSD,
          closedBy: closeReason,
        });

        currentPositions[posKey] = null;
      }
    }

    // Don't open new positions on the last trade
    if (trade !== trades[trades.length - 1]) {
      // Check for new position entries
      for (const strategy of posConfig.trading) {
        const posKey = `${strategy.positionType}_${strategy.entryPricePercent}`;

        if (currentPositions[posKey]) continue;

        if (shouldOpenPosition(strategy, currentPrice, lpEntryPrice)) {
          // Prevent positions opening in same timestamp as other opens/closes
          const hasPositionActivity = positions.some(
            (p) =>
              p.openTimestamp === trade.timestamp ||
              p.closeTimestamp === trade.timestamp
          );

          if (!hasPositionActivity) {
            currentPositions[posKey] = {
              lpPositionId,
              type: strategy.positionType,
              strategyConfig: { ...strategy },
              openTimestamp: trade.timestamp,
              openPrice: currentPrice,
              entryPrice: currentPrice,
              entryAmount: initialPosition.amountUSD,
            };
          }
        }
      }
    }
  }

  // Close remaining positions at end of period
  const lastTrade = trades[trades.length - 1];
  const lastPrice = decodePrice(lastTrade.sqrtPriceX96, pool);

  Object.entries(currentPositions).forEach(([_, position]) => {
    if (!position) return;

    const { pnlPercent, pnlUSD } = calculatePnL(position, lastPrice);

    positions.push({
      ...position,
      closeTimestamp: lastTrade.timestamp,
      closePrice: lastPrice,
      pnlPercent,
      pnlUSD,
      closedBy: "endOfPeriod",
    });
  });

  return positions;
}

function logTradingPosition(pos) {
  log("  Position Type:", pos.type);
  log("  Strategy Config:");
  log("    Entry Price %:", pos.strategyConfig.entryPricePercent);
  log("    Take Profit %:", pos.strategyConfig.takeProfitPercent);
  log("    Stop Loss %:", pos.strategyConfig.stopLossPercent || "None");
  log("  Timing:");
  log("    Opened:", new Date(pos.openTimestamp).toISOString());
  log("    Closed:", new Date(pos.closeTimestamp).toISOString());
  log("  Prices:");
  log("    Entry:", pos.entryPrice);
  log("    Exit:", pos.closePrice);
  log("  Position Size:", pos.entryAmount, "USD");
  log("  Results:");
  log("    PnL %:", pos.pnlPercent.toFixed(2));
  log("    PnL USD:", pos.pnlUSD.toFixed(2));
  log("    Closed By:", pos.closedBy);
  log("-------------------");
}
