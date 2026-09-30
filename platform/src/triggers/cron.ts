// Minimale cron-parser (5 velden: minuut uur dag-van-maand maand dag-van-week).
// Ondersteunt *, */n, a-b, a-b/n, lijsten (a,b,c). Dag-van-week 0 of 7 = zondag.

const RANGES: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseField(field: string, [min, max]: [number, number], isDow: boolean): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Ongeldige stap in '${part}'`);
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { [lo, hi] = range.split("-").map(Number); }
    else { lo = Number(range); hi = stepStr ? max : lo; }
    if (isDow) { if (lo === 7) lo = 0; if (hi === 7) hi = 6; }
    if (![lo, hi].every((n) => Number.isInteger(n) && n >= min && n <= (isDow ? 7 : max)) || lo > hi) throw new Error(`Ongeldige waarde '${part}'`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface Cron {
  expr: string;
  next(from: Date): Date;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron heeft 5 velden nodig: minuut uur dag maand weekdag");
  const [mi, ho, dom, mo, dow] = parts.map((p, i) => parseField(p, RANGES[i], i === 4));
  const domAny = parts[2] === "*", dowAny = parts[4] === "*";
  return {
    expr,
    next(from: Date): Date {
      const d = new Date(from.getTime());
      d.setSeconds(0, 0);
      d.setMinutes(d.getMinutes() + 1);
      for (let i = 0; i < 366 * 24 * 60; i++) {
        const dayOk = domAny && dowAny ? true : domAny ? dow.has(d.getDay()) : dowAny ? dom.has(d.getDate()) : dom.has(d.getDate()) || dow.has(d.getDay());
        if (mo.has(d.getMonth() + 1) && dayOk && ho.has(d.getHours()) && mi.has(d.getMinutes())) return d;
        d.setMinutes(d.getMinutes() + 1);
      }
      throw new Error("Geen volgende uitvoertijd gevonden binnen een jaar");
    }
  };
}
