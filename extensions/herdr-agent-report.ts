import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type HerdrAgentState = "idle" | "working" | "blocked" | "unknown";

const SOURCE = "pi-extension";
const AGENT = "pi";

export default function (pi: ExtensionAPI) {
  const herdrPaneId = process.env.HERDR_PANE_ID;
  const inHerdr = Boolean(process.env.HERDR_ENV && herdrPaneId);

  if (!inHerdr || !herdrPaneId) return;
  const paneId = herdrPaneId;

  let seq = 0;
  let lastState: HerdrAgentState | undefined;

  async function report(state: HerdrAgentState, message?: string) {
    if (lastState === state && !message) return;
    lastState = state;
    seq += 1;

    const args = [
      "pane",
      "report-agent",
      paneId,
      "--source",
      SOURCE,
      "--agent",
      AGENT,
      "--state",
      state,
      "--seq",
      String(seq),
    ];

    if (message) args.push("--message", message);

    try {
      const result = await pi.exec("herdr", args, { timeout: 5000 });
      if (result.code !== 0) {
        // Keep this quiet in normal use; Herdr may be restarting or unavailable.
        console.warn(`[herdr-agent-report] report ${state} failed: ${result.stderr || result.stdout}`);
      }
    } catch (error) {
      console.warn(`[herdr-agent-report] report ${state} failed:`, error);
    }
  }

  async function release() {
    seq += 1;
    try {
      await pi.exec(
        "herdr",
        ["pane", "release-agent", paneId, "--source", SOURCE, "--agent", AGENT, "--seq", String(seq)],
        { timeout: 5000 },
      );
    } catch {
      // Ignore shutdown cleanup failures.
    }
  }

  function setFooter(ctx: ExtensionContext, state: HerdrAgentState) {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("herdr-agent", `Herdr: ${AGENT} ${state}`);
  }

  pi.on("session_start", async (_event, ctx) => {
    await report("idle", "Pi session started");
    setFooter(ctx, "idle");
  });

  pi.on("agent_start", async (_event, ctx) => {
    await report("working");
    setFooter(ctx, "working");
  });

  pi.on("agent_end", async (_event, ctx) => {
    await report("idle");
    setFooter(ctx, "idle");
  });

  pi.on("session_shutdown", async () => {
    await release();
  });

  pi.registerCommand("herdr-agent", {
    description: "Report this Pi pane to Herdr as idle, working, blocked, unknown, or release it",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";

      if (action === "status") {
        ctx.ui.notify(`Herdr pane: ${paneId}; source: ${SOURCE}; last state: ${lastState ?? "not reported"}`, "info");
        return;
      }

      if (action === "release") {
        await release();
        lastState = undefined;
        ctx.ui.notify("Released Pi agent report from Herdr", "info");
        return;
      }

      if (["idle", "working", "blocked", "unknown"].includes(action)) {
        const state = action as HerdrAgentState;
        await report(state, "Manual /herdr-agent command");
        setFooter(ctx, state);
        ctx.ui.notify(`Reported Pi as ${state} to Herdr`, "info");
        return;
      }

      ctx.ui.notify("Usage: /herdr-agent [status|idle|working|blocked|unknown|release]", "warning");
    },
  });
}
