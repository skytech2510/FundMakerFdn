import CONFIG from "#src/config.js";

export const poolMetadataGraphQL = (poolAddress) => `
    query {
      pool(id: "${poolAddress}") {
        id
        token0 {
          symbol
          decimals
        }
        token1 {
          symbol
          decimals
        }
        feeTier
        created:createdAtTimestamp
      }
    }
  `;

export const poolAddressGraphQL = (symbol0, symbol1, feeTier) => `
    query {
      pools(
        where: {
          token0_: {
            ${symbol0 != "_" ? `symbol: "${symbol0}"` : ""}
            derivedETH_gt: 0
          }
          token1_: {
            ${symbol1 != "_" ? `symbol: "${symbol1}"` : ""}
            derivedETH_gt: 0
          }
          ${feeTier ? "feeTier: " + feeTier : ""}
        }
        orderBy: totalValueLockedUSD
        orderDirection: desc
      ) {
        id
        totalValueLockedUSD
        volumeUSD
        feeTier
        token0 {symbol}
        token1 {symbol}
      }
    }
  `;

export const poolTradesGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0
) => `
    query {
      swaps(
        where: {
          pool: "${poolAddress}"
          ${startTimestamp ? `timestamp_gte: ${startTimestamp}` : ""}
          ${startTimestamp && endTimestamp ? "," : ""}
          ${endTimestamp ? `timestamp_lte: ${endTimestamp}` : ""}
        }
        orderBy: timestamp
        orderDirection: asc
        first: ${CONFIG.BATCH_SIZE}
        skip: ${skip}
      ) {
        id
        timestamp
        amount0
        amount1
        amountUSD
        sqrtPriceX96
        tick
      }
    }
  `;

export const poolLiquidityGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip
) => `
    query {
      poolHourDatas(
        where: {
          pool: "${poolAddress}"
          ${startTimestamp ? `periodStartUnix_gte: ${startTimestamp}` : ""}
          ${startTimestamp && endTimestamp ? "," : ""}
          ${endTimestamp ? `periodStartUnix_lte: ${endTimestamp}` : ""}
        }
        orderBy: periodStartUnix
        orderDirection: asc
        first: ${CONFIG.BATCH_SIZE}
        skip: ${skip}
      ) {
        periodStartUnix
        liquidity
        volumeUSD
        feesUSD
      }
    }
  `;

export const findPoolGraphQL = (token0, token1, feeTier) => `
  query {
    pools(
      orderBy: feeTier,
      where: {
        token0_: { symbol: "${token0}" },
        token1_: { symbol: "${token1}" },
        feeTier: "${feeTier}"
      }
    ) {
      id
      token0 {
        symbol
        id
      }
      token1 {
        symbol
        id
      }
      feeTier
    }
  }
`;
