import { delay } from "#src/misc-utils.js";
import axios from "axios";
import "dotenv/config";
async function fetchTopAllCoinMarketCaps(limit, sort, sort_dir, amount) {
  // Top 10000
  amount = amount || 10000;
  const params = {
    start: "1",
    limit: limit ?? 5000,
    sort: sort ?? "market_cap",
    sort_dir: sort_dir ?? "asc",
  };
  const headers = {
    "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY,
  };
  console.log(headers);
  let result = [];
  for (let i = 1; i <= Math.ceil(amount / limit); i++) {
    params.start = (i - 1) * limit + 1;
    const url = process.env.COINMARKETCAP_LATEST_PRICES_URL;
    try {
      const response = await axios.get(url, { params, headers });
      result = result.concat(response.data.data);
      console.log(response.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      await delay(100);
    }
  }
}
fetchTopAllCoinMarketCaps(5000, "", "", 10000).then(() => {
  console.log("done");
});
