import db from "#src/database.js";
import { pools } from "#src/schema.js";
import { queryPoolAddress } from "#src/graphql.js";
import fs from "fs";
import { program } from "commander";
import { Parser } from "@json2csv/plainjs";
import { formatUSD } from "#src/misc-utils.js";
import { getFeeTierPercentage } from "#src/pool-math.js";

async function findPool(token0, token1, feeTier) {
  const symbol0 = token0.toUpperCase();
  const symbol1 = token1.toUpperCase();

  const poolType = this.opts().type;

  console.log("Searching...");
  const pools = await queryPoolAddress(poolType, symbol0, symbol1, feeTier);

  if (pools.length === 0) {
    console.log("No pools found. Please check the following:");
    console.log("- Should one of the token be wrapped (e.g. WETH)?");
    console.log("- Is pool type correct (see pool-finder -h for help)");
    console.log(`- Try searching the reverse pair - ${symbol1} ${symbol0}?`);
    return;
  }
  console.log("Search results:");
  for (const pool of pools.reverse()) {
    console.log("\nPair", pool.token0.symbol, pool.token1.symbol, pool.id);
    console.log(
      "Total Value Locked (USD):",
      formatUSD(pool.totalValueLockedUSD)
    );
    console.log(
      `Fee tier: ${pool.feeTier} (${(
        getFeeTierPercentage(pool.feeTier) * 100
      ).toPrecision(6)}%)`
    );
  }
  console.log();
}

program
  .description("Find the pool address by token symbols, ranked by TVL")
  .option(
    "-t, --type <poolType>",
    "pool type - UniswapV3_ETH | Thena_BSC",
    "UniswapV3_ETH"
  )
  .argument("<token0>", "token 0 symbol, _ means any")
  .argument("<token1>", "token 1 symbol, _ means any")
  .argument("[feeTier]", "pool fee tier")
  .action(findPool);

program.parse(process.argv);
