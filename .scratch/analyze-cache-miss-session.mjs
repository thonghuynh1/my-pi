import { readFile } from "node:fs/promises";

const [sessionPath] = process.argv.slice(2);
if (!sessionPath) throw new Error("Usage: node .scratch/analyze-cache-miss-session.mjs <session.jsonl>");

const records = (await readFile(sessionPath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => ({ line: index + 1, record: JSON.parse(line) }));

const turns = records
  .filter(({ record }) => record.type === "message" && record.message?.role === "assistant" && record.message.usage)
  .map(({ line, record }) => {
    const { message } = record;
    return {
      line,
      timestamp: message.timestamp ?? record.timestamp,
      cacheRead: message.usage.cacheRead ?? 0,
      cacheWrite: message.usage.cacheWrite ?? 0,
      input: message.usage.input ?? 0,
      output: message.usage.output ?? 0,
      cost: message.usage.cost ?? {},
      provider: message.provider,
      model: message.model,
    };
  });

let previous;
const misses = [];
for (const turn of turns) {
  const promptTokens = turn.input + turn.cacheRead + turn.cacheWrite;
  if (previous && promptTokens > 0 && (turn.cacheRead + turn.cacheWrite > 0 || previous.reportedCache)) {
    const missedTokens = Math.min(previous.promptTokens, promptTokens) - turn.cacheRead;
    if (missedTokens > 1024) {
      const paidTokens = turn.input + turn.cacheWrite;
      const paidPerToken = paidTokens > 0 ? ((turn.cost.input ?? 0) + (turn.cost.cacheWrite ?? 0)) / paidTokens : 0;
      const readPerToken = turn.cacheRead > 0 ? (turn.cost.cacheRead ?? 0) / turn.cacheRead : 0;
      misses.push({ line: turn.line, missedTokens, missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken) });
    }
  }
  if (promptTokens > 0) previous = { promptTokens, reportedCache: previous?.reportedCache || turn.cacheRead + turn.cacheWrite > 0 };
}

console.log(JSON.stringify({
  assistantTurns: turns.length,
  zeroCacheReadTurns: turns.filter((turn) => turn.cacheRead === 0).length,
  piDetectedMisses: misses,
}, null, 2));
