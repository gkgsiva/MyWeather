// How closely several models agree on the rain, for the Model charts screen.
//
// For each rain day, take every model's 24-hour total at one place. When even
// the wettest model gives under 2.5 mm they all say "dry or a sprinkle", which
// is full agreement. Otherwise the score is 100% less the gap between the
// wettest and driest model, measured against the wettest total plus 2.5 mm
// (so 5 mm against 0 mm is a poor match, but 52 mm against 48 mm is a good
// one). The overall score is the mean of the days; at least 3 models must
// have a figure for a day to count.

export const DRY_MM = 2.5;
export const MIN_MODELS = 3;

/** 0–100 for one day's totals (one per model; NaN where a model has none), or null. */
export function dayAgreement(vals) {
  const v = vals.filter(Number.isFinite);
  if (v.length < MIN_MODELS) return null;
  const max = Math.max(...v);
  const min = Math.min(...v);
  if (max < DRY_MM) return 100;
  return Math.max(0, Math.round(100 * (1 - (max - min) / (max + DRY_MM))));
}

export const agreeWord = (s) => (s >= 75 ? "High" : s >= 50 ? "Moderate" : "Low");

/** days: [{ label, vals: [one total per model] }]. Returns { score, word, days: [{ label, score }] } or null. */
export function agreement(days) {
  const per = days.map((d) => ({ label: d.label, score: dayAgreement(d.vals) })).filter((d) => d.score !== null);
  if (!per.length) return null;
  const score = Math.round(per.reduce((a, d) => a + d.score, 0) / per.length);
  return { score, word: agreeWord(score), days: per };
}
