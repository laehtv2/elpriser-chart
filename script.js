const fs = require("fs");

// --- Konstanter ---
const EUR_DKK_RATE = 7.46038; // Nationalbankens standardkurs (ca.)

// --- Retry-capable fetch der sikrer JSON svar ---
async function fetchJSON(url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();

      if (text.trim().startsWith("<")) {
        throw new Error("API returned HTML instead of JSON");
      }

      return JSON.parse(text);

    } catch (err) {
      console.log(`⚠ API-fejl (forsøg ${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// --- Tidsstyring ---
function nowInDK() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const dkOffset = 1; // Bemærk: Bør logisk set håndtere sommertid, men vi holder din logik
  return new Date(utc + dkOffset * 3600000);
}

const dkNow = nowInDK();
dkNow.setMinutes(0, 0, 0);
const start = dkNow;
const end = new Date(start.getTime() + 36 * 3600000);

function formatDK(d) {
  const iso = new Date(d.getTime()).toISOString();
  return iso.slice(0, 16);
}

const startStr = formatDK(start);
const endStr = formatDK(end);

// --- Hent og behandl data ---
(async () => {
  const url =
    "https://api.energidataservice.dk/dataset/DayAheadPrices" +
    `?start=${startStr}&end=${endStr}` +
    `&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}` +
    "&limit=500";

  const json = await fetchJSON(url);
  const records = json.records;

  if (!records || records.length === 0) {
    console.error("Ingen data modtaget");
    return;
  }

  const jf = [];
  const oe = [];

  records.forEach(r => {
    const t = r.TimeDK;
    
    // LOGIK FOR PRIS-VALG:
    let rawPriceDKK = r.DayAheadPriceDKK;

    // Hvis DKK-prisen mangler, brug EUR og konverter
    if (rawPriceDKK === null || rawPriceDKK === undefined) {
      if (r.DayAheadPriceEUR !== null && r.DayAheadPriceEUR !== undefined) {
        rawPriceDKK = r.DayAheadPriceEUR * EUR_DKK_RATE;
        // console.log(`ℹ Konverterede EUR til DKK for ${t} (${r.PriceArea})`);
      } else {
        rawPriceDKK = 0; // Backup hvis begge mangler
      }
    }

    // Konverter fra MWh til kWh (divider med 1000) og læg moms på (1.25)
    const p = (rawPriceDKK / 1000) * 1.25;

    if (r.PriceArea === "DK1") jf.push({ time: t, price: p });
    if (r.PriceArea === "DK2") oe.push({ time: t, price: p });
  });

  // --- Find max/min ---
  function extrema(arr) {
    if (arr.length === 0) return { min: {time: "-", price: 0}, max: {time: "-", price: 0} };
    let min = arr[0], max = arr[0];
    arr.forEach(v => {
      if (v.price < min.price) min = v;
      if (v.price > max.price) max = v;
    });
    return { min, max };
  }

  const jfMM = extrema(jf);
  const oeMM = extrema(oe);

  // --- Gruppering ---
  const times = {};
  function group(arr, key) {
    arr.forEach(d => {
      const hour = d.time.slice(0, 13) + ":00";
      if (!times[hour]) times[hour] = { jf: [], oe: [] };
      times[hour][key].push(d.price);
    });
  }

  group(jf, "jf");
  group(oe, "oe");

  const hours = Object.keys(times).sort();

  // --- Generer CSV filer ---
  let csv1 = "Time,Jylland + Fyn,Sjælland + Øer\n";
  hours.forEach(h => {
    const avgJF = times[h].jf.length ? (times[h].jf.reduce((a,b)=>a+b,0) / times[h].jf.length).toFixed(3) : "";
    const avgOE = times[h].oe.length ? (times[h].oe.reduce((a,b)=>a+b,0) / times[h].oe.length).toFixed(3) : "";
    csv1 += `${h},${avgJF},${avgOE}\n`;
  });

  fs.writeFileSync("data.csv", csv1, "utf8");
  console.log("✔ data.csv genereret");

  let csv2 = " ,Jylland + Fyn, ,Sjælland + Øer, \n";
  csv2 += `Laveste pris,${jfMM.min.time},${(jfMM.min.price).toFixed(2)},${oeMM.min.time},${(oeMM.min.price).toFixed(2)}\n`;
  csv2 += `Højeste pris,${jfMM.max.time},${(jfMM.max.price).toFixed(2)},${oeMM.max.time},${(oeMM.max.price).toFixed(2)}\n`;

  fs.writeFileSync("extrema.csv", csv2, "utf8");
  console.log("✔ extrema.csv genereret");

})();
