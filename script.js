const fs = require("fs");

// --- Tidspunkter ---
const now = new Date();
const start = new Date(now);
start.setMinutes(0,0,0); // rund ned
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

  // Data pr kvartal
  const jf = [];
  const oe = [];

  records.forEach(r => {
    const time = r.TimeDK;
    const price = r.DayAheadPriceDKK;
    if (r.PriceArea === "DK1") jf.push({time, price});
    if (r.PriceArea === "DK2") oe.push({time, price});
  });

  // Find maks/min (baseret på kvartalspriser)
  function findMinMax(arr) {
    let min = arr[0];
    let max = arr[0];
    arr.forEach(v => {
      if (v.price < min.price) min = v;
      if (v.price > max.price) max = v;
    });
    return {min, max};
  }

  const jfMM = findMinMax(jf);
  const oeMM = findMinMax(oe);

  // Midl timepriser
  const times = {};

  function addToTimes(arr, key) {
    arr.forEach(d => {
      const date = new Date(d.time);
      date.setMinutes(0,0,0);
      const hour = date.toISOString().slice(0,16);
      if (!times[hour]) times[hour] = {jf: [], oe: []};
      times[hour][key].push(d.price);
    });
  }

  addToTimes(jf, "jf");
  addToTimes(oe, "oe");

  const hoursSorted = Object.keys(times).sort();

  // Generér CSV
  let csv = "Time,JyllandFyn,SjaellandOeer,MinJF,MinJFTime,MaxJF,MaxJFTime,MinOE,MinOETime,MaxOE,MaxOETime\n";

  hoursSorted.forEach(h => {
    const avgJF =
      times[h].jf.length > 0
        ? (times[h].jf.reduce((a,b)=>a+b,0) / times[h].jf.length).toFixed(3)
        : "";
    const avgOE =
      times[h].oe.length > 0
        ? (times[h].oe.reduce((a,b)=>a+b,0) / times[h].oe.length).toFixed(3)
        : "";

    csv += [
      h,
      avgJF,
      avgOE,
      jfMM.min.price.toFixed(3),
      jfMM.min.time,
      jfMM.max.price.toFixed(3),
      jfMM.max.time,
      oeMM.min.price.toFixed(3),
      oeMM.min.time,
      oeMM.max.price.toFixed(3),
      oeMM.max.time
    ].join(",") + "\n";
  });

  // Gem CSV
  fs.writeFileSync("data.csv", csv, "utf8");
  console.log("data.csv genereret");
})();
