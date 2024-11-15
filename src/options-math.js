export function calculateDTE(openTimestamp, closeTimestamp) {
  const openDate = new Date(openTimestamp);
  const closeDate = new Date(closeTimestamp);
  const timeDiff = closeDate.getTime() - openDate.getTime();
  return Math.ceil((timeDiff / (1000 * 3600 * 24)) * 10) / 10;
}

// Black-Scholes formula implementation
export function blackScholes(S, K, T, r, sigma, type) {
  // Convert sigma from percentage to decimal
  const sigmaDecimal = sigma / 100;

  const d1 =
    (Math.log(S / K) + (r + sigmaDecimal ** 2 / 2) * T) /
    (sigmaDecimal * Math.sqrt(T));
  const d2 = d1 - sigmaDecimal * Math.sqrt(T);

  const Nd1 = cumulativeNormalDistribution(d1);
  const Nd2 = cumulativeNormalDistribution(d2);

  if (type === "call") {
    return S * Nd1 - K * Math.exp(-r * T) * Nd2;
  } else {
    return K * Math.exp(-r * T) * (1 - Nd2) - S * (1 - Nd1);
  }
}

// Standard normal cumulative distribution export function
export function cumulativeNormalDistribution(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) prob = 1 - prob;
  return prob;
}

// Adjust strike price to the nearest step
export function adjustStrikePrice(spotPrice, strikePrice, stepSize) {
  const normalizedStrike = strikePrice * spotPrice;
  const roundedStrike = Math.round(normalizedStrike / stepSize) * stepSize;
  return roundedStrike / spotPrice; // Return as a multiplier of spot price
}

// Calculate option greeks
export function calculateGreeks(S, K, T, r, sigma, type) {
  // Convert sigma from percentage to decimal
  const sigmaDecimal = sigma / 100;

  const d1 =
    (Math.log(S / K) + (r + sigmaDecimal ** 2 / 2) * T) /
    (sigmaDecimal * Math.sqrt(T));
  const d2 = d1 - sigmaDecimal * Math.sqrt(T);

  const Nd1 = cumulativeNormalDistribution(d1);
  const Nd2 = cumulativeNormalDistribution(d2);
  const nPrimeD1 = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);

  const delta = type === "call" ? Nd1 : Nd1 - 1;
  const gamma = nPrimeD1 / (S * sigmaDecimal * Math.sqrt(T));
  const vega = (S * nPrimeD1 * Math.sqrt(T)) / 100; // Expressed in terms of 1% change in volatility
  const theta =
    -(S * sigmaDecimal * nPrimeD1) / (2 * Math.sqrt(T)) / 365 -
    (r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : -Nd2)) / 365;
  const rho = (K * T * Math.exp(-r * T) * (type === "call" ? Nd2 : -Nd2)) / 100; // Expressed in terms of 1% change in interest rate

  return { delta, gamma, vega, theta, rho };
}

export function calculateExpirationDate(openDate, dte) {
  const validDTEs = [0, 3, 7, 14, 21, 30, 60, 90, 180, 252, 365];
  if (!validDTEs.includes(dte)) {
    throw new Error(
      `Invalid DTE: ${dte}. Must be one of ${validDTEs.join(", ")}.`
    );
  }

  let expirationDate = new Date(openDate);
  expirationDate.setUTCHours(8, 0, 0, 0); // Set to 8 AM UTC

  if (dte === 0) {
    // If 8 AM UTC has already passed, move to the next day
    if (expirationDate <= openDate) {
      expirationDate.setUTCDate(expirationDate.getUTCDate() + 1);
    }
  } else if (dte <= 30) {
    // For DTE <= 30, calculate more precisely
    const hoursToAdd = dte * 24;
    expirationDate = new Date(openDate.getTime() + hoursToAdd * 60 * 60 * 1000);

    // Align to 8 AM UTC
    expirationDate.setUTCHours(8, 0, 0, 0);

    // If the calculated time is before the current time, move to the next day
    if (expirationDate <= openDate) {
      expirationDate.setUTCDate(expirationDate.getUTCDate() + 1);
    }

    // For 3 DTE, ensure it's not more than 72 hours from now
    if (dte === 3) {
      const maxExpirationDate = new Date(
        openDate.getTime() + 72 * 60 * 60 * 1000
      );
      if (expirationDate > maxExpirationDate) {
        expirationDate = maxExpirationDate;
        expirationDate.setUTCHours(8, 0, 0, 0);
      }
    }
  } else {
    // For longer-term options, add the number of days
    expirationDate.setUTCDate(expirationDate.getUTCDate() + dte);
  }

  // Final check to ensure the expiration date is always in the future
  while (expirationDate <= openDate) {
    expirationDate.setUTCDate(expirationDate.getUTCDate() + 1);
  }

  return expirationDate;
}
