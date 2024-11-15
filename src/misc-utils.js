export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const mm = (a, b) => [Math.min(a, b), Math.max(a, b)];

export const formatUSD = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);

export const handle = (func, errStr) => {
  // Wrap an async function into the error handler
  return async (...args) => {
    try {
      return func(...args);
    } catch (err) {
      console.error("Error", errStr, err.message);
      throw err;
    }
  };
};

export const padDateMS = (pad, date) =>
  new Date(new Date(date).getTime() + pad);

export const incPercent = (n, p) => n + (n * p) / 100;
export const decPercent = (n, p) => n - (n * p) / 100;
