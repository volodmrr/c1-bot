import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const YEAR = new Date().getFullYear();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IN = join(ROOT, "input/file.csv");
const OUT = join(ROOT, "output/file.csv");
const RATES_DIR = join(ROOT, "data/rates");

const big = (r) => Math.max(r.buy, r.sell);

const rates = readdirSync(RATES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`${RATES_DIR}/${f}`, "utf8")))
  .filter((r) => r.status === "parsed")
  .map((r) => ({
    at: new Date(r.postedAt).getTime(),
    usdUah: big(r.rates.find((x) => x.currency === "USD" && x.quoteCurrency === "UAH")),
    usdtUsd: big(r.rates.find((x) => x.currency === "USDT" && x.quoteCurrency === "USD")),
  }))
  .sort((a, b) => a.at - b.at);

const rateFor = (date) => {
  const cutoff = new Date(`${date}T23:59:59Z`).getTime();
  let hit = null;
  for (const r of rates) {
    if (r.at <= cutoff) hit = r;
    else break;
  }
  return hit;
};

const rows = readFileSync(IN, "utf8")
  .trim()
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((md) => {
    const [mm, dd] = md.split("/");
    const r = rateFor(`${YEAR}-${mm}-${dd}`);
    return r ? `${r.usdUah},${r.usdtUsd}` : ",";
  });

mkdirSync(join(ROOT, "output"), { recursive: true });
writeFileSync(OUT, rows.join("\n") + "\n");

console.log(`${rows.length} rows -> ${OUT} (y ${YEAR})`);
