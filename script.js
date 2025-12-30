const fs = require("fs");

// --- 1. Hent seneste EUR-kurs fra Nationalbanken ---
async function getLatestEuroRate() {
  const rssUrl = "https://www.nationalbanken.dk/api/currencyrates?format=rss&lang=da&isoCodes=EUR";
  try {
    const res = await fetch(rssUrl);
    const xml = await res.text();
    const regex = /koster\s+([\d,]+)\s+DKK/g;
    const matches = [...xml.matchAll(regex)];
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const rate = parseFloat(lastMatch[1].replace(",", ".")) / 100;
      return rate;
    }
  } catch (err) {
    console.error("⚠ Kunne ikke hente live-kurs, bruger 7.4604");
  }
  return 7.4604; 
}

// --- 2. Standard fetch funktion ---
async function fetchJSON(url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (text.trim().startsWith("<")) throw new Error("API returned HTML");
      return JSON.parse(text);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// --- 3. Tidsstyring (Korrekt dansk start-time) ---
function getLocalISOString(date) {
  const offset = date.getTimezoneOffset() * 60000; // MS forskel fra UTC
  const localISOTime = (new Date(date - offset)).toISOString().slice(0, 16);
  return localISOTime;
}

const now = new Date();
now.setMinutes(0, 0, 0);
now.setSeconds(0, 0);

// Vi bruger den lokale tid til at lave start-strengen
const startStr = getLocalISOString(now); 
const endStr = getLocalISOString(new Date(now.getTime() + 36 * 3600000));

(async () => {
  const EUR_DKK_RATE = await getLatestEuroRate();
  console.log(`ℹ Henter data fra: ${startStr} til ${endStr}`);

  const url = `https://api.energidataservice.dk/dataset/DayAheadPrices?start=${startStr}&end=${endStr}&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}&limit=500`;
  
  const json = await fetchJSON(url);
  const records = json.records;

  if (!records || records.length === 0) {
    console.error("Ingen data modtaget");
    return;
  }

  const jfRaw = [];
  const oeRaw = [];

  records.forEach(r => {
    // Filtrér eksplicit så vi kun får rækker der er >= vores start-tid
    // (API'et kan nogle gange inkludere timen før pga. UTC/lokaltid overlap)
    if (r.TimeDK < startStr) return;

    let priceMWh = r.DayAheadPriceDKK;
    if (priceMWh === null || priceMWh === undefined) {
      if (r.DayAheadPriceEUR !== null) {
        priceMWh = r.DayAheadPriceEUR * EUR_DKK_RATE;
      } else {
        priceMWh = 0; 
      }
    }

    const p = (priceMWh / 1000) * 1.25;
    const dataObj = { time: r.TimeDK, price: p };

    if (r.PriceArea === "DK1") jfRaw.push(dataObj);
    if (r.PriceArea === "DK2") oeRaw.push(dataObj);
  });

  // Find extrema (Min/Max) fra rå data
  function findExtrema(arr) {
    if (arr.length === 0) return { min: {time: "-", price: 0}, max: {time: "-", price: 0} };
    let min = arr[0], max = arr[0];
    arr.forEach(v => {
      if (v.price < min.price) min = v;
      if (v.price > max.price) max = v;
    });
    return { min, max };
  }

  const jfMM = findExtrema(jfRaw);
  const oeMM = findExtrema(oeRaw);

  // Gruppering til gennemsnit
  const times = {};
  function group(arr, key) {
    arr.forEach(d => {
      const hour = d.time.slice(0, 13) + ":00"; 
      if (!times[hour]) times[hour] = { jf: [], oe: [] };
      times[hour][key].push(d.price);
    });
  }

  group(jfRaw, "jf");
  group(oeRaw, "oe");

  const hours = Object.keys(times).sort();

  // CSV 1: data.csv
  let csv1 = "Time,Jylland + Fyn,Sjælland + Øer\n";
  hours.forEach(h => {
    const avgJF = times[h].jf.length ? (times[h].jf.reduce((a,b)=>a+b,0) / times[h].jf.length).toFixed(3) : "";
    const avgOE = times[h].oe.length ? (times[h].oe.reduce((a,b)=>a+b,0) / times[h].oe.length).toFixed(3) : "";
    csv1 += `${h.replace("T", " ")},${avgJF},${avgOE}\n`;
  });
  fs.writeFileSync("data.csv", csv1, "utf8");

  // CSV 2: extrema.csv
  let csv2 = " ,Jylland + Fyn, ,Sjælland + Øer, \n";
  csv2 += `Laveste pris,${jfMM.min.time.replace("T", " ")},${(jfMM.min.price).toFixed(2)},${oeMM.min.time.replace("T", " ")},${(oeMM.min.price).toFixed(2)}\n`;
  csv2 += `Højeste pris,${jfMM.max.time.replace("T", " ")},${(jfMM.max.price).toFixed(2)},${oeMM.max.time.replace("T", " ")},${(oeMM.max.price).toFixed(2)}\n`;
  fs.writeFileSync("extrema.csv", csv2, "utf8");

  console.log("✔ Færdig! Startet fra kl. " + startStr.slice(11));
})();
