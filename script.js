const fs = require("fs");

// --- Tidsinterval ---
const now = new Date();
const start = new Date(now);
start.setMinutes(0, 0, 0);
const end = new Date(start.getTime() + 36 * 60 * 60 * 1000);

function format(d) {
  return d.toISOString().slice(0, 16);
}

const startStr = format(start);
const endStr   = format(end);

// --- Hent data ---
(async () => {
  const url =
    "https://api.energidataservice.dk/dataset/DayAheadPrices" +
    `?start=${startStr}&end=${endStr}` +
    `&filter=${encodeURIComponent('{"PriceArea":["DK1","DK2"]}')}` +
    "&limit=500";

  const res = await fetch(url);
  const json = await res.json();
  const records = json.records;

  if (!records || records.length === 0) {
    console.error("Ingen data modtaget");
    return;
  }

  // Opdel i DK1/DK2 og konverter til kr./kWh inkl. moms
  const jf = []; // DK1
  const oe = []; // DK2

  records.forEach(r => {
    const t = r.TimeDK;
    // Konverter kr/MWh -> kr/kWh og læg moms til
    const p = (r.DayAheadPriceDKK / 1000) * 1.25;

    if (r.PriceArea === "DK1") jf.push({ time: t, price: p });
    if (r.PriceArea === "DK2") oe.push({ time: t, price: p });
  });

  // --- Find maks/min ---
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

  // --- MIDL pr time ---
  const times = {};

  function group(arr, key) {
    arr.forEach(d => {
      const date = new Date(d.time);
      date.setMinutes(0,0,0);
      const hour = date.toISOString().slice(0,16);
      if (!times[hour]) times[hour] = { jf: [], oe: [] };
      times[hour][key].push(d.price);
    });
  }

  group(jf, "jf");
  group(oe, "oe");

  const hours = Object.keys(times).sort();

  // --- CSV: data.csv (kun midlet pr time) ---
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

  // --- CSV: extrema.csv (tabel til Datawrapper) ---
  let csv2 = "Type,Omraade,Tidspunkt,Pris\n";

  csv2 += `Laveste pris,Jylland + Fyn,${jfMM.min.time},${jfMM.min.price.toFixed(3)}\n`;
  csv2 += `Højeste pris,Jylland + Fyn,${jfMM.max.time},${jfMM.max.price.toFixed(3)}\n`;
  csv2 += `Laveste pris,Sjælland + Øer,${oeMM.min.time},${oeMM.min.price.toFixed(3)}\n`;
  csv2 += `Højeste pris,Sjælland + Øer,${oeMM.max.time},${oeMM.max.price.toFixed(3)}\n`;

  fs.writeFileSync("extrema.csv", csv2, "utf8");
  console.log("✔ extrema.csv genereret");
})();
