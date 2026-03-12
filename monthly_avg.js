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

// første dag i denne måned
const end = new Date();
end.setDate(1);
end.setHours(0,0,0,0);

// start = 24 måneder før
const start = new Date(end);
start.setMonth(start.getMonth() - 24);

const splitDate = new Date("2025-10-01");

const startStr = start.toISOString().slice(0,10);
const endStr = end.toISOString().slice(0,10);

(async () => {

  const EUR_DKK_RATE = await getLatestEuroRate();

  console.log(`Henter data fra ${startStr} til ${endStr}`);

  let records = [];

  // ---------- ELSPOTPRICES (før okt 2025)
  if (start < splitDate) {

    const endOld = new Date(Math.min(splitDate.getTime(), now.getTime()));
    const endOldStr = endOld.toISOString().slice(0,10);

    const urlOld =
      `https://api.energidataservice.dk/dataset/Elspotprices` +
      `?start=${startStr}` +
      `&end=${endOldStr}` +
      `&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}` +
      `&limit=50000`;

    console.log("Henter Elspotprices...");

    const jsonOld = await fetchJSON(urlOld);

    jsonOld.records.forEach(r => {
      records.push({
        time: r.HourDK,
        area: r.PriceArea,
        priceDKK: r.SpotPriceDKK,
        priceEUR: r.SpotPriceEUR
      });
    });
  }

  // ---------- DAYAHEADPRICES (efter okt 2025)
  if (now > splitDate) {

    const startNew = new Date(Math.max(start.getTime(), splitDate.getTime()));
    const startNewStr = startNew.toISOString().slice(0,10);

    const urlNew =
      `https://api.energidataservice.dk/dataset/DayAheadPrices` +
      `?start=${startNewStr}` +
      `&end=${endStr}` +
      `&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}` +
      `&limit=50000`;

    console.log("Henter DayAheadPrices...");

    const jsonNew = await fetchJSON(urlNew);

    jsonNew.records.forEach(r => {
      records.push({
        time: r.TimeDK,
        area: r.PriceArea,
        priceDKK: r.DayAheadPriceDKK,
        priceEUR: r.DayAheadPriceEUR
      });
    });
  }

  const months = {};

  records.forEach(r => {

    let priceMWh = r.priceDKK;

    if (priceMWh === null && r.priceEUR !== null) {
      priceMWh = r.priceEUR * EUR_DKK_RATE;
    }

    if (!priceMWh) return;

    const priceKWh = (priceMWh / 1000) * 1.25;

    const month = r.time.slice(0,7);

    if (!months[month]) {
      months[month] = { DK1: [], DK2: [] };
    }

    months[month][r.area].push(priceKWh);

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
