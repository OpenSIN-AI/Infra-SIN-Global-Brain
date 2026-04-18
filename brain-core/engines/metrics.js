/**
 * Metrics — counters + histograms with Prometheus text-format export.
 *
 * Kept tiny on purpose: no external prom-client dep, no pull scraper, just
 * the 30 lines we actually need. Histogram uses a reservoir-free streaming
 * approach: fixed-bucket counters for Prometheus, plus a rolling window of
 * the last N samples for live p50/p95.
 *
 * Public API:
 *   m.inc("brain_asks_total", { project: "x" })
 *   m.observe("brain_ask_ms", 8.3, { project: "x" })
 *   m.set("brain_cache_entries", 1234)
 *   m.toPrometheus() -> string
 *   m.snapshot() -> { counters, gauges, histograms: { p50, p95, avg } }
 */

const BUCKETS_MS = [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const ROLLING = 512;

export class Metrics {
  constructor() {
    this.counters = new Map();   // key -> number
    this.gauges = new Map();     // key -> number
    this.histograms = new Map(); // key -> { count, sum, buckets:number[], window:number[] }
    this.startedAt = Date.now();
  }

  inc(name, labels = {}, delta = 1) {
    const key = k(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
  }

  set(name, value, labels = {}) {
    const key = k(name, labels);
    this.gauges.set(key, value);
  }

  observe(name, value, labels = {}) {
    const key = k(name, labels);
    let h = this.histograms.get(key);
    if (!h) {
      h = { count: 0, sum: 0, buckets: new Array(BUCKETS_MS.length).fill(0), window: [] };
      this.histograms.set(key, h);
    }
    h.count += 1;
    h.sum += value;
    for (let i = 0; i < BUCKETS_MS.length; i += 1) {
      if (value <= BUCKETS_MS[i]) h.buckets[i] += 1;
    }
    h.window.push(value);
    if (h.window.length > ROLLING) h.window.splice(0, h.window.length - ROLLING);
  }

  /** Percentile over the rolling window (not Prometheus buckets). */
  percentile(name, p, labels = {}) {
    const h = this.histograms.get(k(name, labels));
    if (!h || !h.window.length) return 0;
    const sorted = [...h.window].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  snapshot() {
    const hist = {};
    for (const [key, h] of this.histograms) {
      const sorted = [...h.window].sort((a, b) => a - b);
      const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
      hist[key] = {
        count: h.count,
        sum: +h.sum.toFixed(3),
        avg: h.count ? +(h.sum / h.count).toFixed(3) : 0,
        p50: +pct(50).toFixed(3),
        p95: +pct(95).toFixed(3),
        p99: +pct(99).toFixed(3)
      };
    }
    return {
      uptimeMs: Date.now() - this.startedAt,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: hist
    };
  }

  toPrometheus() {
    const lines = [];
    for (const [key, val] of this.counters) {
      lines.push(promLine(key, val));
    }
    for (const [key, val] of this.gauges) {
      lines.push(promLine(key, val));
    }
    for (const [key, h] of this.histograms) {
      const { name, labels } = parseKey(key);
      let cumulative = 0;
      for (let i = 0; i < BUCKETS_MS.length; i += 1) {
        cumulative = h.buckets[i];
        lines.push(promLine(`${name}_bucket`, cumulative, { ...labels, le: String(BUCKETS_MS[i]) }));
      }
      lines.push(promLine(`${name}_bucket`, h.count, { ...labels, le: "+Inf" }));
      lines.push(promLine(`${name}_sum`, +h.sum.toFixed(3), labels));
      lines.push(promLine(`${name}_count`, h.count, labels));
    }
    return lines.join("\n") + "\n";
  }
}

function k(name, labels) {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return name;
  return `${name}{${keys.map((x) => `${x}="${String(labels[x]).replace(/"/g, '\\"')}"`).join(",")}}`;
}

function parseKey(key) {
  const idx = key.indexOf("{");
  if (idx === -1) return { name: key, labels: {} };
  const name = key.slice(0, idx);
  const labels = {};
  const inner = key.slice(idx + 1, -1);
  for (const pair of inner.split(",")) {
    const m = pair.match(/^([^=]+)="(.*)"$/);
    if (m) labels[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return { name, labels };
}

function promLine(name, value, labels = {}) {
  const keys = Object.keys(labels);
  if (!keys.length) return `${name} ${value}`;
  const lbl = keys.map((x) => `${x}="${String(labels[x]).replace(/"/g, '\\"')}"`).join(",");
  return `${name}{${lbl}} ${value}`;
}
