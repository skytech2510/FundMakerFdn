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
        feeTier:fee
        created:createdAtTimestamp
      }
    }
  `;
export const poolAddressGraphQL = (symbol0, symbol1, _) => `
    query {
      pools(
        where: {
          token0_: {
            ${symbol0 != "_" ? `symbol: "${symbol0}"` : ""}
            derivedBnb_gt: 0
          }
          token1_: {
            ${symbol1 != "_" ? `symbol: "${symbol1}"` : ""}
            derivedBnb_gt: 0
          }
        }
        orderBy: totalValueLockedUSD
        orderDirection: desc
      ) {
        id
        totalValueLockedUSD
        volumeUSD
        feeTier:fee
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
          ${
            startTimestamp
              ? `timestamp_gte: ${startTimestamp}${endTimestamp ? "," : ""}`
              : ""
          }
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
        sqrtPriceX96:price
        tick
      }
    }
  `;

export const poolLiquidityGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0
) => `
    query {
      poolHourDatas(
        where: {
          pool: "${poolAddress}"
          ${
            startTimestamp
              ? `periodStartUnix_gte: ${startTimestamp}${
                  endTimestamp ? "," : ""
                }`
              : ""
          }
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

export const poolFeeTiersGraphQL = (
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0
) => `
    query {
      feeHourDatas(
        where: {
          pool: "${poolAddress}"
          ${
            startTimestamp
              ? `timestamp_gte: ${startTimestamp}${endTimestamp ? "," : ""}`
              : ""
          }
          ${endTimestamp ? `timestamp_lte: ${endTimestamp}` : ""}
        }
        orderBy: timestamp
        orderDirection: asc
        first: ${CONFIG.BATCH_SIZE}
        skip: ${skip}
      ) {
        timestamp
        minFee
        maxFee
      }
    }
  `;
