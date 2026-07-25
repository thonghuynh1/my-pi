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
  const parts = sf.split("/");
  const basename = parts[parts.length-1];
  const meta = statusMap[basename] || {};
  return Object.assign({}, r, {
    name: meta.name || basename,
    method: meta.method || "?",
    scenario: meta.scenario || "?",
    rep: meta.repetition || "?",
  });
});

const aiknow = joined.filter(r => r.method === "aiknow");
const grep = joined.filter(r => r.method === "grep");
const avg = (arr, key) => arr.reduce((s,r) => s+(r[key]||0), 0) / arr.length;

console.log("Per-session table:");
console.log("Name | Method | Scenario | Rep | Duration_s | API_calls | Tool_calls | Input_toks | Cost | PeakCtx | ToolResultChars");
for (const r of joined) {
  console.log([r.name, r.method, r.scenario, r.rep, r.duration_seconds.toFixed(1), r.assistant_api_calls, r.tool_calls, r.sum_request_input_tokens, r.total_cost_usd.toFixed(4), r.peak_request_context_tokens, r.tool_result_chars].join(" | "));
}

const aiknowDur = avg(aiknow, "duration_seconds");
const grepDur = avg(grep, "duration_seconds");
const aiknowAPI = avg(aiknow, "assistant_api_calls");
const grepAPI = avg(grep, "assistant_api_calls");
const aiknowTools = avg(aiknow, "tool_calls");
const grepTools = avg(grep, "tool_calls");
const aiknowInputToks = avg(aiknow, "sum_request_input_tokens");
const grepInputToks = avg(grep, "sum_request_input_tokens");
const aiknowCost = avg(aiknow, "total_cost_usd");
const grepCost = avg(grep, "total_cost_usd");
const aiknowResultChars = avg(aiknow, "tool_result_chars");
const grepResultChars = avg(grep, "tool_result_chars");
const aiknowPeakCtx = avg(aiknow, "peak_request_context_tokens");
const grepPeakCtx = avg(grep, "peak_request_context_tokens");

console.log("\nMETHOD MEANS:");
console.log("Duration: aiknow=" + aiknowDur.toFixed(3) + "s grep=" + grepDur.toFixed(3) + "s ratio=" + (aiknowDur/grepDur*100).toFixed(1) + "% (" + ((aiknowDur/grepDur-1)*100).toFixed(1) + "% slower)");
console.log("API calls: aiknow=" + aiknowAPI.toFixed(3) + " grep=" + grepAPI.toFixed(3) + " ratio=" + (aiknowAPI/grepAPI*100).toFixed(1) + "%");
console.log("Tool calls: aiknow=" + aiknowTools.toFixed(3) + " grep=" + grepTools.toFixed(3) + " ratio=" + (aiknowTools/grepTools*100).toFixed(1) + "%");
console.log("Input tokens: aiknow=" + aiknowInputToks.toFixed(0) + " grep=" + grepInputToks.toFixed(0) + " ratio=" + (aiknowInputToks/grepInputToks*100).toFixed(1) + "%");
console.log("Cost: aiknow=" + aiknowCost.toFixed(6) + " grep=" + grepCost.toFixed(6) + " ratio=" + (aiknowCost/grepCost*100).toFixed(1) + "%");
console.log("Tool result chars: aiknow=" + aiknowResultChars.toFixed(0) + " grep=" + grepResultChars.toFixed(0) + " ratio=" + (aiknowResultChars/grepResultChars*100).toFixed(1) + "%");
console.log("Peak context: aiknow=" + aiknowPeakCtx.toFixed(0) + " grep=" + grepPeakCtx.toFixed(0) + " ratio=" + (aiknowPeakCtx/grepPeakCtx*100).toFixed(1) + "%");

// Scenario breakdown
console.log("\nSCENARIO BREAKDOWN:");
for (const sc of ["lifecycle", "architecture", "impact"]) {
  const ak = aiknow.filter(r => r.scenario === sc);
  const gp = grep.filter(r => r.scenario === sc);
  if (ak.length === 0 || gp.length === 0) continue;
  const akDur = avg(ak, "duration_seconds");
  const gpDur = avg(gp, "duration_seconds");
  const akAPI = avg(ak, "assistant_api_calls");
  const gpAPI = avg(gp, "assistant_api_calls");
  const akTools = avg(ak, "tool_calls");
  const gpTools = avg(gp, "tool_calls");
  console.log("Scenario: " + sc + " | dur_ratio=" + (akDur/gpDur).toFixed(3) + "x | api_ratio=" + (akAPI/gpAPI).toFixed(3) + "x | tool_ratio=" + (akTools/gpTools).toFixed(3) + "x");
  console.log("  aiknow: dur=" + akDur.toFixed(1) + "s, api=" + akAPI.toFixed(1) + ", tools=" + akTools.toFixed(1));
  console.log("  grep:   dur=" + gpDur.toFixed(1) + "s, api=" + gpAPI.toFixed(1) + ", tools=" + gpTools.toFixed(1));
}

console.log("\nIMPACT SESSIONS DETAIL:");
for (const r of joined.filter(r => r.scenario === "impact")) {
  const tn = JSON.stringify(r.tool_calls_by_name || {});
  console.log(r.name + ": dur=" + r.duration_seconds.toFixed(1) + "s API=" + r.assistant_api_calls + " tools=" + r.tool_calls + " tools/API=" + (r.tool_calls/r.assistant_api_calls).toFixed(2) + " tools_by_name=" + tn);
}
