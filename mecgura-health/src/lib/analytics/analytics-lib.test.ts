import { describe, expect, it } from "vitest";
import { compareValues, formatPct, rate, resolveRange } from "./range";
import { AGE_GROUPS, ageGroup, ageOf, average, dailySeries, divRound, durationStats, median, minutesBetween } from "./stats";
import { DEFAULT_THRESHOLDS, evaluateInsights, parseThresholds } from "./insights";
import { crc32, toCsv, toPrintableHtml, toXlsx, type Column, type ReportMeta } from "./export";

const TZ = "Asia/Kolkata"; const TODAY = "2026-10-08"; // a Thursday
const r = (preset: string, extra: Record<string, unknown> = {}) => resolveRange({ preset, ...extra }, TZ, TODAY);

describe("date ranges in the clinic timezone", () => {
  it("resolves every preset", () => {
    expect(r("today")).toMatchObject({ from: "2026-10-08", to: "2026-10-08", days: 1 });
    expect(r("yesterday")).toMatchObject({ from: "2026-10-07", to: "2026-10-07", days: 1 });
    expect(r("last7")).toMatchObject({ from: "2026-10-02", to: "2026-10-08", days: 7 });
    expect(r("last30")).toMatchObject({ from: "2026-09-09", to: "2026-10-08", days: 30 });
    expect(r("thisMonth")).toMatchObject({ from: "2026-10-01", to: "2026-10-08", days: 8 });
    expect(r("lastMonth")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", days: 30 });
    expect(r("thisQuarter")).toMatchObject({ from: "2026-10-01", to: "2026-10-08" });
    expect(r("thisYear")).toMatchObject({ from: "2026-01-01", to: "2026-10-08" });
    expect(resolveRange({ preset: "thisQuarter" }, TZ, "2026-08-15")).toMatchObject({ from: "2026-07-01" });
    expect(r("nonsense").preset).toBe("last30");
  });
  it("uses the clinic's midnight, not UTC", () => {
    const t = r("today"); // 00:00 IST = 18:30 UTC the day before
    expect(t.start.toISOString()).toBe("2026-10-07T18:30:00.000Z"); expect(t.end.toISOString()).toBe("2026-10-08T18:30:00.000Z");
    expect(resolveRange({ preset: "today" }, "America/New_York", TODAY).start.toISOString()).toBe("2026-10-08T04:00:00.000Z");
  });
  it("handles leap years and year boundaries", () => {
    expect(resolveRange({ preset: "lastMonth" }, TZ, "2028-03-10")).toMatchObject({ from: "2028-02-01", to: "2028-02-29", days: 29 });
    expect(resolveRange({ preset: "lastMonth" }, TZ, "2027-01-05")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(resolveRange({ preset: "last7" }, TZ, "2027-01-03")).toMatchObject({ from: "2026-12-28" });
  });
  it("validates custom ranges", () => {
    expect(r("custom", { from: "2026-10-01", to: "2026-10-03" })).toMatchObject({ days: 3 });
    expect(() => r("custom", { from: "2026-10-05", to: "2026-10-01" })).toThrow(/after/);
    expect(() => r("custom", { from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => r("custom", { from: "bad", to: "2026-03-01" })).toThrow();
    expect(() => r("custom", {})).toThrow();
    expect(() => r("custom", { from: "2024-01-01", to: "2026-01-01" })).toThrow(/one year/);
  });
  it("previous period = the equal-length period just before", () => {
    const c = r("last7", { compare: true }); expect(c.previous).toMatchObject({ from: "2026-09-25", to: "2026-10-01", days: 7 });
    expect(r("lastMonth", { compare: true }).previous).toMatchObject({ from: "2026-08-02", to: "2026-08-31", days: 30 });
    expect(r("last7").previous).toBeNull();
  });
});

describe("comparison and rates", () => {
  it("shows N/A instead of misleading percentages", () => {
    expect(compareValues(5, 0)).toMatchObject({ pctTenths: null, state: "na", reason: "previous-zero" });
    expect(compareValues(0, 0)).toMatchObject({ pctTenths: null, state: "flat" });
    expect(compareValues(12, 10)).toMatchObject({ pctTenths: 200, state: "up", delta: 2 });
    expect(compareValues(5, 10)).toMatchObject({ pctTenths: -500, state: "down" });
    expect(compareValues(10, 10)).toMatchObject({ pctTenths: 0, state: "flat" });
    expect(compareValues(9, 3, { insufficientHistory: true })).toMatchObject({ pctTenths: null, state: "na", reason: "insufficient-history" });
    expect(formatPct(null)).toBe("N/A"); expect(formatPct(125)).toBe("+12.5%"); expect(formatPct(-500)).toBe("-50.0%");
  });
  it("rate is null for a zero denominator and uses integer maths", () => {
    expect(rate(1, 0)).toBeNull(); expect(rate(0, 5)).toBe(0); expect(rate(1, 3)).toBe(33.3); expect(rate(2, 3)).toBe(66.7); expect(rate(5, 5)).toBe(100);
  });
});

describe("statistics", () => {
  it("median / average / durations ignore missing and negative values", () => {
    expect(median([])).toBeNull(); expect(median([5])).toBe(5); expect(median([1, 9, 3])).toBe(3); expect(median([1, 2, 3, 4])).toBe(3); expect(average([])).toBeNull(); expect(average([10, 20, 31])).toBe(20);
    const a = new Date("2026-01-01T10:00:00Z"); const b = new Date("2026-01-01T10:20:00Z");
    expect(minutesBetween(a, b)).toBe(20); expect(minutesBetween(b, a)).toBeNull(); expect(minutesBetween(null, b)).toBeNull();
    expect(durationStats([10, 20, null, 30, -5 as never])).toMatchObject({ samples: 3, averageMin: 20, medianMin: 20, maxMin: 30, available: true });
    expect(durationStats([null, null])).toMatchObject({ samples: 0, averageMin: null, available: false });
  });
  it("age groups use the specified boundaries", () => {
    expect(AGE_GROUPS).toEqual(["0–12", "13–18", "19–30", "31–45", "46–60", "61–75", "76+"]);
    const at = (n: number) => ageGroup(n);
    expect([0, 12, 13, 18, 19, 30, 31, 45, 46, 60, 61, 75, 76, 99].map(at)).toEqual(["0–12", "0–12", "13–18", "13–18", "19–30", "19–30", "31–45", "31–45", "46–60", "46–60", "61–75", "61–75", "76+", "76+"]);
    expect(ageGroup(null)).toBeNull(); expect(ageGroup(-1)).toBeNull(); expect(ageGroup(200)).toBeNull();
    expect(ageOf({ dateOfBirth: new Date("2000-10-09T00:00:00Z") }, "2026-10-08")).toBe(25); expect(ageOf({ dateOfBirth: new Date("2000-10-08T00:00:00Z") }, "2026-10-08")).toBe(26);
    expect(ageOf({ ageYears: 40 }, "2026-10-08")).toBe(40); expect(ageOf({}, "2026-10-08")).toBeNull();
  });
  it("daily series is zero-filled and money division is integer", () => {
    expect(dailySeries("2026-10-01", "2026-10-03", new Map([["2026-10-02", 4]]))).toEqual([{ date: "2026-10-01", value: 0 }, { date: "2026-10-02", value: 4 }, { date: "2026-10-03", value: 0 }]);
    expect(divRound(41800, 3)).toBe(13933); expect(divRound(5, 2)).toBe(3); expect(divRound(0, 0)).toBe(0);
  });
});

describe("rule-based insights", () => {
  it("fires only above the configured thresholds and with enough data", () => {
    const t = DEFAULT_THRESHOLDS;
    expect(evaluateInsights({ appointments: { total: 20, noShow: 2, cancelled: 1, due: 20 } }, t)).toEqual([]);
    const hit = evaluateInsights({ appointments: { total: 20, noShow: 4, cancelled: 8, due: 18 } }, t);
    expect(hit.map((i) => i.key).sort()).toEqual(["cancellation-rate", "no-show-rate"]);
    expect(evaluateInsights({ appointments: { total: 4, noShow: 4, cancelled: 0, due: 4 } }, t)).toEqual([]); // sample too small
    expect(evaluateInsights({ followUps: { overdue: 5 } }, t)[0]).toMatchObject({ key: "overdue-followups", severity: "attention" });
    expect(evaluateInsights({ followUps: { overdue: 15 } }, t)[0].severity).toBe("critical");
    expect(evaluateInsights({ followUps: { overdue: 4 } }, t)).toEqual([]);
    expect(evaluateInsights({ pharmacy: { belowReorder: 2, outOfStock: 1, expiringBatches: 0, expiredBatches: 0 } }, t).map((i) => i.key)).toEqual(["out-of-stock", "below-reorder"]);
    expect(evaluateInsights({ waiting: { avgMin: null, samples: 0 } }, t)).toEqual([]);
    expect(evaluateInsights({ appointments: { total: 20, noShow: 4, cancelled: 0, due: 18 } }, { ...t, noShowRatePct: 50 })).toEqual([]);
  });
  it("never produces medical advice wording", () => {
    const all = evaluateInsights({ appointments: { total: 20, noShow: 18, cancelled: 18, due: 20 }, followUps: { overdue: 50 }, pharmacy: { belowReorder: 3, outOfStock: 2, expiringBatches: 2, expiredBatches: 1 }, billing: { overdueInvoices: 9 }, communication: { total: 20, failed: 10 }, lab: { avgHours: 99, samples: 9 }, waiting: { avgMin: 90, samples: 20 } }, DEFAULT_THRESHOLDS);
    expect(all.length).toBeGreaterThan(8);
    for (const i of all) expect(`${i.title} ${i.detail}`).not.toMatch(/\b(diagnos|prescrib|treat|should take|recommend|predict)/i);
  });
  it("parses stored thresholds defensively", () => {
    expect(parseThresholds(null)).toEqual(DEFAULT_THRESHOLDS); expect(parseThresholds("not json")).toEqual(DEFAULT_THRESHOLDS);
    expect(parseThresholds(JSON.stringify({ noShowRatePct: 30, overdueFollowUps: -2, labTurnaroundHours: "x", extra: 1 }))).toEqual({ ...DEFAULT_THRESHOLDS, noShowRatePct: 30 });
  });
});

const meta: ReportMeta = { name: "Test", description: "d", dataSource: "x", range: "a to b", timezone: TZ, generatedAt: "now", generatedBy: "Admin", filters: "", currency: "INR" };
const cols: Column[] = [{ key: "n", label: "Name" }, { key: "amt", label: "Amount", type: "money" }, { key: "q", label: "Qty", type: "number" }];
describe("export writers", () => {
  it("CSV neutralises formulas, quotes properly and keeps numbers numeric", () => {
    const csv = toCsv(meta, cols, [{ n: "=HYPERLINK(\"x\")", amt: "-12.50", q: 3 }, { n: "+1 555", amt: "0.00", q: 0 }, { n: "A, \"B\"\nC", amt: "1.00", q: 1 }, { n: "@cmd", amt: "1.00", q: 1 }]);
    expect(csv).toContain("'=HYPERLINK(\"\"x\"\")"); expect(csv).toContain("'+1 555"); expect(csv).toContain("'@cmd"); expect(csv).toContain("\"A, \"\"B\"\"\nC\""); expect(csv).toContain(",-12.50,3");
    expect(csv.startsWith("Report,Test")).toBe(true); expect(csv).toMatch(/Name,Amount,Qty\r\n/); expect(csv).toContain("Timezone,Asia/Kolkata");
  });
  it("XLSX is a valid zip with correct CRCs and escaped text", () => {
    const bytes = toXlsx(meta, cols, [{ n: "<b>&\"x\"</b>", amt: "10.25", q: 2 }]);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const names: string[] = []; let p = 0; const dec = new TextDecoder(); let sheet = "";
    while (dv.getUint32(p, true) === 0x04034b50) {
      const crc = dv.getUint32(p + 14, true); const size = dv.getUint32(p + 18, true); const nl = dv.getUint16(p + 26, true); const el = dv.getUint16(p + 28, true);
      const name = dec.decode(bytes.subarray(p + 30, p + 30 + nl)); const data = bytes.subarray(p + 30 + nl + el, p + 30 + nl + el + size);
      expect(crc32(data)).toBe(crc); names.push(name); if (name === "xl/worksheets/sheet1.xml") sheet = dec.decode(data); p += 30 + nl + el + size;
    }
    expect(names).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    expect(sheet).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;"); expect(sheet).toContain("<v>10.25</v>");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("printable page escapes content and carries no script", () => {
    const html = toPrintableHtml(meta, cols, [{ n: "<script>alert(1)</script>", amt: "1.00", q: 1 }], "Clinic <X>");
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("Clinic &lt;X&gt;"); expect(html).toContain("Generated by");
  });
});
