const fs = require("fs");

// --- Funktion til at hente seneste EUR-kurs fra Nationalbanken ---
async function getLatestEuroRate() {
  const rssUrl = "https://www.nationalbanken.dk/api/currencyrates?format=rss&lang=da&isoCodes=EUR";
  try {
    const res = await fetch(rssUrl);
    const xml = await res.text();
    
    // Vi finder ALLE forekomster af mønsteret "koster XXX,XX DKK"
    const regex = /koster\s+([\d,]+)\s+DKK/g;
    const matches = [...xml.matchAll(regex)];
    
    if (matches.length > 0) {
      // Vi tager det SIDSTE match i listen, da det er den nyeste dato
      const lastMatch = matches[matches.length - 1];
      const rateStr = lastMatch[1];
      
      const rate = parseFloat(rateStr.replace(",", ".")) / 100;
      console.log(`ℹ Nationalbanken kurs fundet (nyeste nederst): 1 EUR = ${rate} DKK`);
      return rate;
    }
  } catch (err) {
    console.error("⚠ Kunne ikke hente live-kurs, bruger standardkurs (7.4604):", err.message);
  }
  return 7.4604; 
}

// --- Standard fetch funktion ---
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

// --- Tidsopsætning (bruger nuværende tid i ISO) ---
const now = new Date();
now.setMinutes(0, 0, 0);
const startStr = now.toISOString().slice(0, 16);
const endStr = new Date(now.getTime() + 36 * 3600000).toISOString().slice(0, 16);

(async () => {
  // 1. Hent den dagsaktuelle kurs fra RSS
  const EUR_DKK_RATE = await getLatestEuroRate();

  // 2. Hent elpriser
  const url = `https://api.energidataservice.dk/dataset/DayAheadPrices?start=${startStr}&end=${endStr}&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}&limit=500`;
  const json = await fetchJSON(url);
  const records = json.records;

  if (!records || records.length === 0) {
    console.error("Ingen data modtaget fra Energi Data Service");
    return;
  }

  const jf = [];
  const oe = [];

  records.forEach(r => {
    let priceMWh = r.DayAheadPriceDKK;
    
    // Fallback logik: Hvis DKK mangler, brug EUR * Nationalbankens kurs
    if (priceMWh === null || priceMWh === undefined) {
      if (r.DayAheadPriceEUR !== null && r.DayAheadPriceEUR !== undefined) {
        priceMWh = r.DayAheadPriceEUR * EUR_DKK_RATE;
      } else {
        priceMWh = 0; 
      }
    }

    // Beregn kr/kWh inkl. moms
    const p = (priceMWh / 1000) * 1.25;
    const dataObj = { time: r.TimeDK, price: p };

    if (r.PriceArea === "DK1") jf.push(dataObj);
    if (r.PriceArea === "DK2") oe.push(dataObj);
  });

  // Sortering (sikrer kronologisk rækkefølge)
  jf.sort((a, b) => a.time.localeCompare(b.time));
  oe.sort((a, b) => a.time.localeCompare(b.time));

  // Find extrema
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

  // --- CSV GENERERING ---

  // data.csv
  let csv1 = "Time,Jylland + Fyn,Sjælland + Øer\n";
  jf.forEach((row, index) => {
    const time = row.time.replace("T", " ");
    const priceJF = row.price.toFixed(3);
    const priceOE = oe[index] ? oe[index].price.toFixed(3) : "";
    csv1 += `${time},${priceJF},${priceOE}\n`;
  });
  fs.writeFileSync("data.csv", csv1, "utf8");

  // extrema.csv
  let csv2 = " ,Jylland + Fyn, ,Sjælland + Øer, \n";
  csv2 += `Laveste pris,${jfMM.min.time.replace("T", " ")},${(jfMM.min.price).toFixed(2)},${oeMM.min.time.replace("T", " ")},${(oeMM.min.price).toFixed(2)}\n`;
  csv2 += `Højeste pris,${jfMM.max.time.replace("T", " ")},${(jfMM.max.price).toFixed(2)},${oeMM.max.time.replace("T", " ")},${(oeMM.max.price).toFixed(2)}\n`;
  fs.writeFileSync("extrema.csv", csv2, "utf8");

  console.log(`✔ Succes! data.csv og extrema.csv er opdateret.`);
})();
