import "dotenv/config";
import axios from "axios";
const fetchHistoricalKlines = async (
  symbol,
  startDate = Date.now(),
  endDate = Date.now() - 604800000,
  interval,
  limit = 500
) => {
  const url = process.env.BINANCE_KLINE_URL;
  const params = {
    symbol: symbol,
    startTime: startDate,
    endTime: endDate,
    interval: interval,
    limit: limit,
  };
  const headers = {
    "X-MBX-APIKEY": process.env.BINANCE_API_KEY,
  };
  try {
    const response = await axios.get(url, { params, headers });
    console.log(response.data);
  } catch (error) {
    console.error(error);
  }
};
fetchHistoricalKlines(
  "BTCUSDT",
  Date.now() - 604800000,
  Date.now(),
  "1d",
  500
).then((e) => {
  console.log("sdfsdf");
});
