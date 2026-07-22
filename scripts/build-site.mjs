import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RATES_DIR = join(ROOT, "data/rates");
const OUT = join(ROOT, "site/data.json");

const KYIV_DATE = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Kyiv",
});

const leg = (rates, currency, quote) => {
  const r = rates.find((x) => x.currency === currency && x.quoteCurrency === quote);
  return r ? { buy: r.buy, sell: r.sell } : null;
};

const round2 = (n) => Math.round(n * 100) / 100;

const byDate = {};
for (const f of readdirSync(RATES_DIR)) {
  if (!f.endsWith(".json")) continue;
  const m = JSON.parse(readFileSync(join(RATES_DIR, f), "utf8"));
  if (m.status !== "parsed") continue;

  const date = KYIV_DATE.format(new Date(m.postedAt));
  // Keep the latest post of each day.
  if (byDate[date] && byDate[date].postedAt >= m.postedAt) continue;

  const usdUah = leg(m.rates, "USD", "UAH");
  const usdtUsd = leg(m.rates, "USDT", "USD");
  const usdtUah =
    usdUah && usdtUsd
      ? { buy: round2(usdUah.buy * usdtUsd.buy), sell: round2(usdUah.sell * usdtUsd.sell) }
      : null;

  byDate[date] = { postedAt: m.postedAt, usdUah, usdtUsd, usdtUah };
}

const sorted = Object.fromEntries(Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, JSON.stringify(sorted) + "\n");
console.log(`${Object.keys(sorted).length} days -> ${OUT}`);
