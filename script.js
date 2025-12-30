const fs = require("fs");

// --- 1. Hent seneste EUR-kurs fra Nationalbanken (Sidste element i RSS) ---
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
      console.log(`ℹ Nationalbanken kurs anvendt: 1 EUR = ${rate} DKK`);
      return rate;
    }
  } catch (err) {
    console.error("⚠ Kunne ikke hente live-kurs, bruger standardkurs (7.4604):", err.message);
  }
  return 7.4604; 
}

// --- 2. Standard fetch funktion med retries ---
async function fetchJSON(url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (text.trim().startsWith("<")) throw new Error("API returned HTML");
      return JSON.parse(text);
    } catch (err) {
      console.log(`⚠ API-fejl (forsøg ${i}/${retries}): ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// --- 3. Tidsopsætning ---
const now = new Date();
now.setMinutes(0, 0, 0);
const startStr = now.toISOString().slice(0, 16);
const endStr = new Date(now.getTime() + 36 * 3600000).toISOString().slice(0, 16);

(async () => {
  const EUR_DKK_RATE = await getLatestEuroRate();

  const url = `https://api.energidataservice.dk/dataset/DayAheadPrices?start=${startStr}&end=${endStr}&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}&limit=500`;
  const json = await fetchJSON(url);
  const records = json.records;

  if (!records || records.length === 0) {
    console.error("Ingen data modtaget");
    return;
  }

  const jfRaw = [];
  const oeRaw = [];

  // Behandl hver record og håndter EUR fallback
  records.forEach(r => {
    let priceMWh = r.DayAheadPriceDKK;
    
    if (priceMWh === null || priceMWh === undefined) {
      if (r.DayAheadPriceEUR !== null && r.DayAheadPriceEUR !== undefined) {
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

  // Find max/min (Extrema)
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

  // --- GRUPPERING OG GENNEMSNIT (Som i din oprindelige kode) ---
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

  // --- CSV 1: data.csv (Gennemsnit pr. time) ---
  let csv1 = "Time,Jylland + Fyn,Sjælland + Øer\n";
  hours.forEach(h => {
    const avgJF = times[h].jf.length
      ? (times[h].jf.reduce((a,b)=>a+b,0) / times[h].jf.length).toFixed(3)
      : "";

    const avgOE = times[h].oe.length
      ? (times[h].oe.reduce((a,b)=>a+b,0) / times[h].oe.length).toFixed(3)
      : "";

    csv1 += `${h.replace("T", " ")},${avgJF},${avgOE}\n`;
  });

  fs.writeFileSync("data.csv", csv1, "utf8");
  console.log("✔ data.csv genereret (med gennemsnit)");

  // --- CSV 2: extrema.csv ---
  let csv2 = " ,Jylland + Fyn, ,Sjælland + Øer, \n";
  csv2 += `Laveste pris,${jfMM.min.time.replace("T", " ")},${(jfMM.min.price).toFixed(2)},${oeMM.min.time.replace("T", " ")},${(oeMM.min.price).toFixed(2)}\n`;
  csv2 += `Højeste pris,${jfMM.max.time.replace("T", " ")},${(jfMM.max.price).toFixed(2)},${oeMM.max.time.replace("T", " ")},${(oeMM.max.price).toFixed(2)}\n`;

  fs.writeFileSync("extrema.csv", csv2, "utf8");
  console.log("✔ extrema.csv genereret");

})();
