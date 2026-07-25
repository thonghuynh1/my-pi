const fs = require("fs");
const runStatus = JSON.parse(fs.readFileSync("./run-status.json", "utf8"));
const retrievalEff = JSON.parse(fs.readFileSync("./retrieval-efficiency-results.json", "utf8"));
const statusMap = {};
for (const s of runStatus) {
  const sf = s.session_file.split("\\").join("/");
  const parts = sf.split("/");
  statusMap[parts[parts.length-1]] = s;
}
const joined = retrievalEff.map(r => {
  const sf = r.session_file.split("\\").join("/");
  const basename = sf.split("/").pop();
  const meta = statusMap[basename] || {};
  return Object.assign({}, r, { name: meta.name||basename, method: meta.method||"?", scenario: meta.scenario||"?", rep: meta.repetition||"?" });
});

// Pearson correlation
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b)/n, my = ys.reduce((a,b)=>a+b)/n;
  const num = xs.reduce((s,x,i) => s+(x-mx)*(ys[i]-my), 0);
  const den = Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0) * ys.reduce((s,y)=>s+(y-my)**2,0));
  return den === 0 ? 0 : num/den;
}

const durs = joined.map(r => r.duration_seconds);
const apis = joined.map(r => r.assistant_api_calls);
const tools = joined.map(r => r.tool_calls);
const inputToks = joined.map(r => r.sum_request_input_tokens);
const peakCtx = joined.map(r => r.peak_request_context_tokens);
const costs = joined.map(r => r.total_cost_usd);

console.log("CORRELATIONS with duration_seconds (all 18 sessions):");
console.log("  r(duration, API_calls) =", pearson(durs, apis).toFixed(4));
console.log("  r(duration, tool_calls) =", pearson(durs, tools).toFixed(4));
console.log("  r(duration, input_tokens) =", pearson(durs, inputToks).toFixed(4));
console.log("  r(duration, peak_ctx_tokens) =", pearson(durs, peakCtx).toFixed(4));
console.log("  r(duration, cost) =", pearson(durs, costs).toFixed(4));
console.log("  r(API_calls, tool_calls) =", pearson(apis, tools).toFixed(4));
console.log("  r(input_tokens, duration) =", pearson(inputToks, durs).toFixed(4));
console.log("  r(peak_ctx, tool_result_chars) =", pearson(peakCtx, joined.map(r=>r.tool_result_chars)).toFixed(4));

// Regression: duration ~ API_calls
const n = 18;
const mx = apis.reduce((a,b)=>a+b)/n;
const my = durs.reduce((a,b)=>a+b)/n;
const b1 = apis.reduce((s,x,i)=>s+(x-mx)*(durs[i]-my),0) / apis.reduce((s,x)=>s+(x-mx)**2,0);
const b0 = my - b1*mx;
console.log("\nLinear regression: duration = " + b0.toFixed(1) + " + " + b1.toFixed(2) + " * API_calls");
const resids = joined.map((r,i) => r.duration_seconds - (b0 + b1*r.assistant_api_calls));
const rmse = Math.sqrt(resids.reduce((s,r)=>s+r*r,0)/n);
console.log("RMSE:", rmse.toFixed(1) + "s");
for (const r of joined) {
  const pred = b0 + b1*r.assistant_api_calls;
  const resid = r.duration_seconds - pred;
  if (Math.abs(resid) > 20) console.log("  High residual:", r.name, "actual=" + r.duration_seconds.toFixed(1) + "s pred=" + pred.toFixed(1) + "s resid=" + resid.toFixed(1) + "s");
}

// Duration per API turn
console.log("\nDuration per API turn per session:");
for (const r of joined) {
  const perCall = r.duration_seconds / r.assistant_api_calls;
  console.log("  " + r.name + " (" + r.method + "): " + perCall.toFixed(1) + "s/call");
}

// What accounts for the 94.5% difference
const aiknow = joined.filter(r => r.method === "aiknow");
const grep = joined.filter(r => r.method === "grep");
const avg = (arr, key) => arr.reduce((s,r)=>s+(r[key]||0),0)/arr.length;

const akDur = avg(aiknow, "duration_seconds");
const gpDur = avg(grep, "duration_seconds");
const akAPI = avg(aiknow, "assistant_api_calls");
const gpAPI = avg(grep, "assistant_api_calls");

const durPerCallAK = akDur / akAPI;
const durPerCallGP = gpDur / gpAPI;
const extraTurns = akAPI - gpAPI;
const extraTime = extraTurns * durPerCallAK;
const explained = extraTime / (akDur - gpDur);

console.log("\nSLOWDOWN DECOMPOSITION:");
console.log("Observed gap:", (akDur - gpDur).toFixed(1) + "s");
console.log("Extra turns:", extraTurns.toFixed(1) + " × aiknow time/turn " + durPerCallAK.toFixed(1) + "s = " + extraTime.toFixed(1) + "s explained");
console.log("Fraction explained by extra turns:", (explained*100).toFixed(1) + "%");
console.log("Remaining (residual from diff in time/turn):", ((akDur-gpDur) - extraTime).toFixed(1) + "s");
