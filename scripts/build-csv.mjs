import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RATES_DIR = join(ROOT, "data/rates");
const OUT_DIR = join(ROOT, "data/google");
const OUT = join(OUT_DIR, "buy-usd.csv");

const KYIV_DATE = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Kyiv",
});

const leg = (rates, currency, quote) =>
  rates.find((x) => x.currency === currency && x.quoteCurrency === quote) ?? null;

// Latest parsed post per Kyiv day.
const byDate = {};
for (const f of readdirSync(RATES_DIR)) {
  if (!f.endsWith(".json")) continue;
  const m = JSON.parse(readFileSync(join(RATES_DIR, f), "utf8"));
  if (m.status !== "parsed") continue;

  const usdUah = leg(m.rates, "USD", "UAH");
  const usdtUsd = leg(m.rates, "USDT", "USD");
  if (!usdUah || !usdtUsd) continue;

  const date = KYIV_DATE.format(new Date(m.postedAt));
  if (byDate[date] && byDate[date].postedAt >= m.postedAt) continue;

  // Sell-side: what you pay to buy USD.
  // uah  = UAH per USD  -> USD = uahAmount / uah
  // usdt = USD per USDT -> USD = usdtAmount * usdt
  byDate[date] = { postedAt: m.postedAt, uah: usdUah.sell, usdt: usdtUsd.sell };
}

const rows = Object.keys(byDate)
  .sort((a, b) => a.localeCompare(b))
  .map((d) => `${d},${byDate[d].uah},${byDate[d].usdt}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, "date,uah,usdt\n" + rows.join("\n") + "\n");
console.log(`${rows.length} days -> ${OUT}`);
