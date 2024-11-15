// Whitepaper formula implementation code
// Ref: https://github.com/normdoow/uniswap.fish

import bn from "bignumber.js";

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

const Q96 = new bn(2).pow(96);
const Q128 = new bn(2).pow(128);
const ZERO = new bn(0);

export const TICK_MIN = -887272;
export const TICK_MAX = 887272;
// Lower tick corresponds to higher price
export const PRICE_MIN = getPriceFromTick(TICK_MAX);
export const PRICE_MAX = getPriceFromTick(TICK_MIN);

export function getFeeTierPercentage(tier) {
  return Number(tier) / 1000000;
}

// The function to analyze onchain positions
// Ref: https://ethereum.stackexchange.com/a/144704
export function calculatePositionFees(pool, position, token0, token1) {
  const tickCurrent = Number(pool.tick);
  const tickLower = Number(position.tickLower.tickIdx);
  const tickUpper = Number(position.tickUpper.tickIdx);
  const liquidity = new bn(position.liquidity);

  // Check out the relevant formulas below which are from Uniswap Whitepaper Section 6.3 and 6.4
  // 𝑓𝑟 =𝑓𝑔−𝑓𝑏(𝑖𝑙)−𝑓𝑎(𝑖𝑢)
  // 𝑓𝑢 =𝑙·(𝑓𝑟(𝑡1)−𝑓𝑟(𝑡0))
  // Global fee growth per liquidity '𝑓𝑔' for both token 0 and token 1
  let feeGrowthGlobal_0 = new bn(pool.feeGrowthGlobal0X128);
  let feeGrowthGlobal_1 = new bn(pool.feeGrowthGlobal1X128);

  // Fee growth outside '𝑓𝑜' of our lower tick for both token 0 and token 1
  let tickLowerFeeGrowthOutside_0 = new bn(
    position.tickLower.feeGrowthOutside0X128
  );
  let tickLowerFeeGrowthOutside_1 = new bn(
    position.tickLower.feeGrowthOutside1X128
  );

  // Fee growth outside '𝑓𝑜' of our upper tick for both token 0 and token 1
  let tickUpperFeeGrowthOutside_0 = new bn(
    position.tickUpper.feeGrowthOutside0X128
  );
  let tickUpperFeeGrowthOutside_1 = new bn(
    position.tickUpper.feeGrowthOutside1X128
  );

  // These are '𝑓𝑏(𝑖𝑙)' and '𝑓𝑎(𝑖𝑢)' from the formula
  // for both token 0 and token 1
  let tickLowerFeeGrowthBelow_0 = ZERO;
  let tickLowerFeeGrowthBelow_1 = ZERO;
  let tickUpperFeeGrowthAbove_0 = ZERO;
  let tickUpperFeeGrowthAbove_1 = ZERO;

  // These are the calculations for '𝑓b(𝑖)' from the formula
  // for both token 0 and token 1
  if (tickCurrent >= tickLower) {
    tickLowerFeeGrowthBelow_0 = tickLowerFeeGrowthOutside_0;
    tickLowerFeeGrowthBelow_1 = tickLowerFeeGrowthOutside_1;
  } else {
    tickLowerFeeGrowthBelow_0 = feeGrowthGlobal_0.minus(
      tickLowerFeeGrowthOutside_0
    );
    tickLowerFeeGrowthBelow_1 = feeGrowthGlobal_1.minus(
      tickLowerFeeGrowthOutside_1
    );
  }

  // These are the calculations for '𝑓𝑎(𝑖)' from the formula
  // for both token 0 and token 1
  if (tickCurrent < tickUpper) {
    tickUpperFeeGrowthAbove_0 = tickUpperFeeGrowthOutside_0;
    tickUpperFeeGrowthAbove_1 = tickUpperFeeGrowthOutside_1;
  } else {
    tickUpperFeeGrowthAbove_0 = feeGrowthGlobal_0.minus(
      tickUpperFeeGrowthOutside_0
    );
    tickUpperFeeGrowthAbove_1 = feeGrowthGlobal_1.minus(
      tickUpperFeeGrowthOutside_1
    );
  }

  // Calculations for '𝑓𝑟(𝑡1)' part of the '𝑓𝑢 =𝑙·(𝑓𝑟(𝑡1)−𝑓𝑟(𝑡0))' formula
  // for both token 0 and token 1
  let fr_t1_0 = feeGrowthGlobal_0
    .minus(tickLowerFeeGrowthBelow_0)
    .minus(tickUpperFeeGrowthAbove_0);
  let fr_t1_1 = feeGrowthGlobal_1
    .minus(tickLowerFeeGrowthBelow_1)
    .minus(tickUpperFeeGrowthAbove_1);

  // '𝑓𝑟(𝑡0)' part of the '𝑓𝑢 =𝑙·(𝑓𝑟(𝑡1)−𝑓𝑟(𝑡0))' formula
  // for both token 0 and token 1
  let feeGrowthInsideLast_0 = new bn(position.feeGrowthInside0LastX128);
  let feeGrowthInsideLast_1 = new bn(position.feeGrowthInside1LastX128);

  // The final calculations for the '𝑓𝑢 =𝑙·(𝑓𝑟(𝑡1)−𝑓𝑟(𝑡0))' uncollected fees formula
  // for both token 0 and token 1 since we now know everything that is needed to compute it
  let uncollectedFees_0 = mulDiv(
    liquidity,
    fr_t1_0.minus(feeGrowthInsideLast_0),
    Q128
  );
  let uncollectedFees_1 = mulDiv(
    liquidity,
    fr_t1_1.minus(feeGrowthInsideLast_1),
    Q128
  );

  // Decimal adjustment to get final results
  let uncollectedFeesAdjusted_0 = uncollectedFees_0.div(
    expandDecimals(1, Number(token0?.decimals || 18)).toFixed(
      Number(token0?.decimals || 18)
    )
  );
  let uncollectedFeesAdjusted_1 = uncollectedFees_1.div(
    expandDecimals(1, Number(token1?.decimals || 18)).toFixed(
      Number(token1?.decimals || 18)
    )
  );

  return [
    uncollectedFeesAdjusted_0.toNumber(),
    uncollectedFeesAdjusted_1.toNumber(),
  ];
}

export function getTickFromPrice(price, token0Decimal, token1Decimal) {
  const token0 = expandDecimals(price, Number(token0Decimal));
  const token1 = expandDecimals(1, Number(token1Decimal));
  const sqrtPrice = encodeSqrtPriceX96(token1).div(encodeSqrtPriceX96(token0));

  return Math.log(sqrtPrice.toNumber()) / Math.log(Math.sqrt(1.0001));
}

export function getPriceFromTick(tick, token0Decimal = 0, token1Decimal = 0) {
  const sqrtPrice = new bn(Math.pow(Math.sqrt(1.0001), tick)).multipliedBy(
    new bn(2).pow(96)
  );
  const token0 = expandDecimals(1, Number(token0Decimal));
  const token1 = expandDecimals(1, Number(token1Decimal));
  const L2 = mulDiv(
    encodeSqrtPriceX96(token0),
    encodeSqrtPriceX96(token1),
    Q96
  );
  const price = mulDiv(L2, Q96, sqrtPrice)
    .div(new bn(2).pow(96))
    .div(new bn(10).pow(token0Decimal))
    .pow(2);

  return price.toNumber();
}

// Calculate the position tokens deposit ratio.
export function getPositionTokensDepositRatio(P, Pl, Pu) {
  const deltaL = 1000; // can be any number

  let deltaY = deltaL * (Math.sqrt(P) - Math.sqrt(Pl));
  if (P < Pl) deltaY = 0;
  if (P >= Pu) deltaY = deltaL * (Math.sqrt(Pu) - Math.sqrt(Pl));

  let deltaX = deltaL * (1 / Math.sqrt(P) - 1 / Math.sqrt(Pu));
  if (P < Pl) deltaX = deltaL * (1 / Math.sqrt(Pl) - 1 / Math.sqrt(Pu));
  if (P >= Pu) deltaX = 0;

  return deltaY / deltaX;
}

export function getTokensAmountFromDepositAmountUSD(
  P,
  Pl,
  Pu,
  priceUSDX,
  priceUSDY,
  depositAmountUSD
) {
  const deltaL =
    depositAmountUSD /
    ((Math.sqrt(P) - Math.sqrt(Pl)) * priceUSDY +
      (1 / Math.sqrt(P) - 1 / Math.sqrt(Pu)) * priceUSDX);

  let deltaY = deltaL * (Math.sqrt(P) - Math.sqrt(Pl));
  if (deltaY * priceUSDY < 0) deltaY = 0;
  if (deltaY * priceUSDY > depositAmountUSD)
    deltaY = depositAmountUSD / priceUSDY;

  let deltaX = deltaL * (1 / Math.sqrt(P) - 1 / Math.sqrt(Pu));
  if (deltaX * priceUSDX < 0) deltaX = 0;
  if (deltaX * priceUSDX > depositAmountUSD)
    deltaX = depositAmountUSD / priceUSDX;

  return {
    amount0: deltaX,
    amount1: deltaY,
    liquidityDelta: deltaL,
  };
}

// for calculation detail, please visit README.md (Section: Calculation Breakdown, No. 2)
function getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amount0) {
  // amount0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower))
  const intermediate = mulDiv(sqrtRatioBX96, sqrtRatioAX96, Q96);
  return mulDiv(amount0, intermediate, sqrtRatioBX96.minus(sqrtRatioAX96));
}

function getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amount1) {
  // amount1 / (sqrt(upper) - sqrt(lower))
  return mulDiv(amount1, Q96, sqrtRatioBX96.minus(sqrtRatioAX96));
}

function getSqrtPriceX96(price, token0Decimal, token1Decimal) {
  const token0 = expandDecimals(price, token0Decimal);
  const token1 = expandDecimals(1, token1Decimal);

  return token0.div(token1).sqrt().multipliedBy(Q96);
}

export function getLiquidityDelta(
  P,
  lowerP,
  upperP,
  amount0,
  amount1,
  token0Decimal,
  token1Decimal
) {
  const amt0 = expandDecimals(amount0, token1Decimal);
  const amt1 = expandDecimals(amount1, token0Decimal);

  const sqrtRatioX96 = getSqrtPriceX96(P, token0Decimal, token1Decimal);
  const sqrtRatioAX96 = getSqrtPriceX96(lowerP, token0Decimal, token1Decimal);
  const sqrtRatioBX96 = getSqrtPriceX96(upperP, token0Decimal, token1Decimal);

  let liquidity;
  if (sqrtRatioX96.lte(sqrtRatioAX96)) {
    liquidity = getLiquidityForAmount0(sqrtRatioAX96, sqrtRatioBX96, amt0);
  } else if (sqrtRatioX96.lt(sqrtRatioBX96)) {
    const liquidity0 = getLiquidityForAmount0(
      sqrtRatioX96,
      sqrtRatioBX96,
      amt0
    );
    const liquidity1 = getLiquidityForAmount1(
      sqrtRatioAX96,
      sqrtRatioX96,
      amt1
    );

    liquidity = bn.min(liquidity0, liquidity1);
  } else {
    liquidity = getLiquidityForAmount1(sqrtRatioAX96, sqrtRatioBX96, amt1);
  }

  return liquidity;
}

export function estimateFee(liquidityDelta, liquidity, volumeUSD, feeTier) {
  const feeTierPercentage = getFeeTierPercentage(feeTier);
  const liquidityPercentage = new bn(liquidityDelta).div(
    new bn(liquidity).plus(liquidityDelta)
  );

  return new bn(volumeUSD)
    .multipliedBy(feeTierPercentage)
    .multipliedBy(liquidityPercentage)
    .toNumber();
}

export function getLiquidityFromTick(poolTicks, tick) {
  // calculate a cumulative of liquidityNet from all ticks that poolTicks[i] <= tick
  let liquidity = new bn(0);
  for (let i = 0; i < poolTicks.length - 1; ++i) {
    liquidity = liquidity.plus(new bn(poolTicks[i].liquidityNet));

    const lowerTick = Number(poolTicks[i].tickIdx);
    const upperTick = Number(poolTicks[i + 1]?.tickIdx);

    if (lowerTick <= tick && tick <= upperTick) {
      break;
    }
  }

  return liquidity;
}

export function encodeSqrtPriceX96(price) {
  return new bn(price).sqrt().multipliedBy(Q96).integerValue(bn.ROUND_FLOOR);
}

export function decodeSqrtPriceX96(sqrtPrice) {
  return new bn(sqrtPrice).div(Q96).pow(2);
}

export function expandDecimals(n, exp = 1) {
  return new bn(n).multipliedBy(new bn(10).pow(exp));
}

export function decodePrice(sqrtPrice, pool) {
  return +expandDecimals(
    decodeSqrtPriceX96(sqrtPrice),
    pool.token0Decimals - pool.token1Decimals
  );
}

function mulDiv(a, b, multiplier) {
  return a.multipliedBy(b).div(multiplier);
}

export function calculateIL(
  futurePrice,
  priceRangeValue,
  liquidityDelta,
  amount0,
  amount1
) {
  let Pl = priceRangeValue[0];
  let Pu = priceRangeValue[1];

  // Strategy A: based on current amount and future price
  const valueUSDToken0A = amount0 * futurePrice[0];
  const valueUSDToken1A = amount1 * futurePrice[1];
  const totalValueA = valueUSDToken0A + valueUSDToken1A;

  // Strategy B: calculating token amounts for future prices
  let futureP = futurePrice[1] / futurePrice[0];
  if (futureP < Pl) futureP = Pl;
  if (futureP > Pu) futureP = Pu;

  let deltaY = liquidityDelta * (Math.sqrt(futureP) - Math.sqrt(Pl));
  if (deltaY * futurePrice[0] < 0) deltaY = 0;
  if (futureP < Pl) deltaY = 0;

  let deltaX = liquidityDelta * (1 / Math.sqrt(futureP) - 1 / Math.sqrt(Pu));
  if (deltaX * futurePrice[1] < 0) deltaX = 0;

  // Strategy B values
  const valueUSDToken0B = deltaY * futurePrice[0];
  const valueUSDToken1B = deltaX * futurePrice[1];

  // Total Value B
  const totalValueB = valueUSDToken0B + valueUSDToken1B;

  // Calculate Impermanent Loss (IL)
  const IL = Math.abs(totalValueA - totalValueB);
  const ILPercentage = Math.abs((100 * IL) / totalValueA);

  return {
    totalValueB,
    ILPercentage,
  };
}

export function calculateStandardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}
