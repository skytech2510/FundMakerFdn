import axios from "axios";
import CONFIG from "#src/config.js";
import { delay } from "#src/misc-utils.js";

import * as UniswapV3_ETH from "./UniswapV3_ETH/graphql.js";
import * as Thena_BSC from "./Thena_BSC/graphql.js";

const getSubgraphURL = (type) => CONFIG.SUBGRAPH_URLS[type];
const q = { UniswapV3_ETH, Thena_BSC };

// Helper function to send GraphQL queries
async function sendGraphQLQuery(poolType, query) {
  let retryCount = 0;
  while (true) {
    try {
      const response = await axios.post(getSubgraphURL(poolType), { query });
      return response?.data?.data || null;
    } catch (error) {
      retryCount++;
      console.error(
        `Error fetching data for ${poolType} (Attempt ${retryCount}):`,
        error.message
      );
      if (error.response) {
        console.error("Error response:", error.response.data);
      }
      console.log(`Retrying in ${CONFIG.DELAY_BETWEEN_REQUESTS}ms...`);
      await delay(CONFIG.DELAY_BETWEEN_REQUESTS);
    }
  }
}

// Helper function for handling paginated data fetching
async function fetchPaginatedData(
  fetchFn,
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp,
  skip = 0,
  accumulatedData = []
) {
  const newData = await fetchFn(
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  );
  if (!newData) return accumulatedData;

  const allData = accumulatedData.concat(newData);

  if (newData.length === CONFIG.BATCH_SIZE) {
    await delay(CONFIG.DELAY_BETWEEN_REQUESTS);
    return fetchPaginatedData(
      fetchFn,
      poolType,
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip + CONFIG.BATCH_SIZE,
      allData
    );
  }
  return allData;
}

// Function to get pool metadata
export async function queryPoolMetadata(poolType, poolAddress) {
  const query = q[poolType].poolMetadataGraphQL(poolAddress);
  const data = await sendGraphQLQuery(poolType, query);
  if (data?.pool) return data.pool;
  else {
    console.error("Unexpected response structure for pool metadata:", data);
    return null;
  }
}

export async function queryPoolAddress(
  poolType,
  symbol0,
  symbol1,
  feeTier = null
) {
  const query = q[poolType].poolAddressGraphQL(symbol0, symbol1, feeTier);
  const data = await sendGraphQLQuery(poolType, query);
  if (data?.pools) return data.pools;
  else {
    console.error(
      "Unexpected response structure for pool address query:",
      data
    );
    return null;
  }
}

// Function to fetch pool trades (with pagination)
export async function queryPoolTrades(
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp
) {
  const fetchTrades = async (
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  ) => {
    const query = q[poolType].poolTradesGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const data = await sendGraphQLQuery(poolType, query);
    return data?.swaps || [];
  };

  return fetchPaginatedData(
    fetchTrades,
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp
  );
}

// Function to fetch pool liquidity (with pagination)
export async function queryPoolLiquidity(
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp
) {
  const fetchLiquidity = async (
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  ) => {
    const query = q[poolType].poolLiquidityGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const data = await sendGraphQLQuery(poolType, query);
    return data?.poolHourDatas || [];
  };

  return fetchPaginatedData(
    fetchLiquidity,
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp
  );
}

// Function to fetch pool fee tiers (with pagination)
export async function queryPoolFeeTiers(
  poolType,
  poolAddress,
  startTimestamp,
  endTimestamp
) {
  const fetchFeeTiers = async (
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp,
    skip
  ) => {
    const query = q[poolType].poolFeeTiersGraphQL(
      poolAddress,
      startTimestamp,
      endTimestamp,
      skip
    );
    const data = await sendGraphQLQuery(poolType, query);
    return (data?.feeHourDatas || []).map((datapoint) => ({
      ...datapoint,
      feeTier: (Number(datapoint.minFee) + Number(datapoint.maxFee)) / 2,
    }));
  };

  return fetchPaginatedData(
    fetchFeeTiers,
    poolType,
    poolAddress,
    startTimestamp,
    endTimestamp
  );
}
