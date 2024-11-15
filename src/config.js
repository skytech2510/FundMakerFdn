import { config } from "dotenv";
config();

const CONFIG = {
  POOL_ADDRESS: "0x1123e75b71019962cd4d21b0f3018a6412edb63c",
  POOL_TYPE: "Thena_BSC", // UniswapV3_ETH, Thena_BSC
  START_DATE: new Date("2024-09-14T17:12:00.000Z"), // data fetch start date
  END_DATE: new Date("2024-09-30T11:12:00.000Z"), // data fetch end date

  BATCH_SIZE: 1000,
  DELAY_BETWEEN_REQUESTS: 1000, // in milliseconds

  SUBGRAPH_URLS: {
    UniswapV3_ETH: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.SUBGRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`,
    Thena_BSC: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.SUBGRAPH_API_KEY}/subgraphs/id/Hnjf3ipVMCkQze3jmHp8tpSMgPmtPnXBR38iM4ix1cLt`,
  },

  // Pools with dynamic fee tiers
  DYNAMIC_FEE_POOLS: ["Thena_BSC"],

  // Make sure that the swap reflects the current price
  SWAP_USD_THRESHOLD: 1,

  // Fetch also one day before and after the period
  FETCH_PAD_MS: 24 * 60 * 60000,

  // Default simulation position size
  DEFAULT_POS_USD: 100,

  VERBOSE: process.env.VERBOSE || false,

  // Constants for fetch-spot
  SPOT_API_URL: "https://api.binance.com/api/v3/klines",
  SPOT_SYMBOLS: ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
  SPOT_BATCH_SIZE: 1000,
  IV_API_URL: "https://rest-v1.volmex.finance/public/iv/history",
  IV_SYMBOLS: ["BVIV", "EVIV"],

  dbFilename: "data.db",

  // Options strike price steps
  STRIKE_PRICE_STEPS: {
    BNBUSDT: 10,
    ETHUSDT: 50,
    BTCUSDT: 500,
  },

  // Maximum allowable time difference for spot price in milliseconds
  MAX_SPOT_TIMEDIST: 2 * 60 * 60 * 1000, // 2 hours
};

/*CONFIG.position = {
  invPrices: true, // only visually
  amountUSD: 52,
  uptickPercent: 20, // +% of openPrice for price range
  downtickPercent: 20, // -% of openPrice for price range
  openPrice: null, // if null, detects from openTime
  closePrice: null, // if null, detects from closeTime
  openTime: CONFIG.START_DATE,
  closeTime: CONFIG.END_DATE,
  poolAddress: CONFIG.POOL_ADDRESS,
  poolType: CONFIG.POOL_TYPE,
};*/

export default CONFIG;
