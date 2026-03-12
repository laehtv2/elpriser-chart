const fs = require("fs");

// -------- Hent EUR kurs --------
async function getLatestEuroRate() {
  const url = "https://www.nationalbanken.dk/api/currencyrates?format=rss&lang=da&isoCodes=EUR";
  try {
    const res = await fetch(url);
    const xml = await res.text();
    const regex = /koster\s+([\d,]+)\s+DKK/g;
    const matches = [...xml.matchAll(regex)];
    if (matches.length > 0) {
      const rate = parseFloat(matches[matches.length - 1][1].replace(",", ".")) / 100;
      return rate;
    }
  } catch {
    console.log("⚠ bruger fallback EUR kurs");
  }
  return 7.4604;
}

// -------- Fetch helper --------
async function fetchJSON(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error("API returned HTML");
  return JSON.parse(text);
}

// -------- Datoer --------
const now = new Date();
const start = new Date();
start.setMonth(start.getMonth() - 24);

const startStr = start.toISOString().slice(0,10);
const endStr = now.toISOString().slice(0,10);

(async () => {

  const EUR_DKK_RATE = await getLatestEuroRate();

  console.log(`Henter data fra ${startStr} til ${endStr}`);

  const url =
    `https://api.energidataservice.dk/dataset/DayAheadPrices` +
    `?start=${startStr}` +
    `&end=${endStr}` +
    `&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}` +
    `&limit=50000`;

  const json = await fetchJSON(url);

  const records = json.records;

  const months = {};

  records.forEach(r => {

    let priceMWh = r.DayAheadPriceDKK;

    if (priceMWh === null && r.DayAheadPriceEUR !== null) {
      priceMWh = r.DayAheadPriceEUR * EUR_DKK_RATE;
    }

    if (!priceMWh) return;

    const priceKWh = (priceMWh / 1000) * 1.25;

    const month = r.TimeDK.slice(0,7);

    if (!months[month]) {
      months[month] = { DK1: [], DK2: [] };
    }

    months[month][r.PriceArea].push(priceKWh);

  });

  const sortedMonths = Object.keys(months).sort();

  let csv = "Month,Jylland + Fyn,Sjælland + Øer\n";

  sortedMonths.forEach(m => {

    const avg = arr => arr.length
      ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(3)
      : "";

    const jf = avg(months[m].DK1);
    const oe = avg(months[m].DK2);

    csv += `${m},${jf},${oe}\n`;

  });

  fs.writeFileSync("monthly_power_prices.csv", csv, "utf8");

  console.log("✔ monthly_power_prices.csv gemt");

})();
