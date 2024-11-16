import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
const limit = 5000;
const sort = "market_cap";
const sort_dir = "asc"; //asc or desc
const COINMARKETCAP_API_KEY = "d1fbffa3-54f4-4d3f-83bb-7aa57df4e73d";
async function fetchTopAllCoinMarketCaps() {
  // Top 10000
  const url =
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest";
  const params = {
    start: "1",
    limit: limit,
    sort: sort,
    sort_dir: sort_dir,
  };
  const headers = {
    "X-CMC_PRO_API_KEY": COINMARKETCAP_API_KEY,
    // "X-CMC_PRO_API_KEY": "d1fbffa3-54f4-4d3f-83bb-7aa57df4e73d",
  };
  console.log(headers);
  try {
    const response1 = await axios.get(url, { params, headers });
    try {
      params.start = params.start + limit;
      const response2 = await axios.get(url, { params, headers });
      console.log(response1.data.data.length);
    } catch (e) {
      console.log(e);
    }
  } catch (e) {
    console.log(e);
  }
}
fetchTopAllCoinMarketCaps().then(() => {
  console.log("done");
});
