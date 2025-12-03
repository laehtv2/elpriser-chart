const fs = require("fs");

// --- Retry-capable fetch der sikrer JSON svar ---
async function fetchJSON(url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();

      // Hvis API’et svarer HTML → fejl
      if (text.trim().startsWith("<")) {
        throw new Error("API returned HTML instead of JSON");
      }

      return JSON.parse(text);

    } catch (err) {
      console.log(`⚠ API-fejl (forsøg ${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000)); // prøv igen efter 2 sek
    }
  }
}

// --- Tidsinterval baseret på DK-tid ---
const now = new Date();

// Sæt starten til DEN TIME VI ER I (DK-tid)
const dkStart = new Date(now);
dkStart.setMinutes(0, 0, 0);

// Konverter DK-start → UTC
const start = new Date(dkStart);

// Slut = start + 36 timer
const end = new Date(start.getTime() + 36 * 60 * 60 * 1000);

// Format til API
function formatDK(d) {
  const iso = new Date(d.getTime()).toISOString();
  return iso.slice(0, 16);
}


const startStr = formatDK(start);
const endStr = formatDK(end);

// --- Hent data ---
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

  // Opdel i DK1/DK2 og konverter til kr/kWh inkl. moms
  const jf = [];
  const oe = [];

  records.forEach(r => {
    const t = r.TimeDK; // brug dansk tid som du ønskede
    const p = (r.DayAheadPriceDKK / 1000) * 1.25;

    if (r.PriceArea === "DK1") jf.push({ time: t, price: p });
    if (r.PriceArea === "DK2") oe.push({ time: t, price: p });
  });

  // Find max/min
  function extrema(arr) {
    let min = arr[0], max = arr[0];
    arr.forEach(v => {
      if (v.price < min.price) min = v;
      if (v.price > max.price) max = v;
    });
    return { min, max };
  }

  const jfMM = extrema(jf);
  const oeMM = extrema(oe);

  // MIDLET pr time
  const times = {};

  function group(arr, key) {
    arr.forEach(d => {
      const date = new Date(d.time);
      date.setMinutes(0, 0, 0);
      const hour = date.toISOString().slice(0, 16);
      if (!times[hour]) times[hour] = { jf: [], oe: [] };
      times[hour][key].push(d.price);
    });
  }

  group(jf, "jf");
  group(oe, "oe");

  const hours = Object.keys(times).sort();

  // CSV: data.csv
  let csv1 = "Time,Jylland + Fyn,Sjælland + Øer\n";

  hours.forEach(h => {
    const avgJF = times[h].jf.length
      ? (times[h].jf.reduce((a,b)=>a+b,0) / times[h].jf.length).toFixed(3)
      : "";

    const avgOE = times[h].oe.length
      ? (times[h].oe.reduce((a,b)=>a+b,0) / times[h].oe.length).toFixed(3)
      : "";

    csv1 += `${h},${avgJF},${avgOE}\n`;
  });

  fs.writeFileSync("data.csv", csv1, "utf8");
  console.log("✔ data.csv genereret");

  // EXTREMA CSV (uændret som ønsket)
  let csv2 = " ,Jylland + Fyn, ,Sjælland + Øer, \n";

  csv2 += `Laveste pris,${jfMM.min.time},${(jfMM.min.price).toFixed(2)},${oeMM.min.time},${(oeMM.min.price).toFixed(2)}\n`;
  csv2 += `Højeste pris,${jfMM.max.time},${(jfMM.max.price).toFixed(2)},${oeMM.max.time},${(oeMM.max.price).toFixed(2)}\n`;

  fs.writeFileSync("extrema.csv", csv2, "utf8");
  console.log("✔ extrema.csv genereret");

})();
