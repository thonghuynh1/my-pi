import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createManagedExtension,
  loadCapabilityVisibilitySettings,
  type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

type HerdrAgentState = "idle" | "working" | "blocked" | "unknown";

const SOURCE = "pi-extension";
const AGENT = "pi";

// Seq must survive module re-import across /new (jiti uses moduleCache:false).
// globalThis persists for the process lifetime.
const SEQ_KEY = Symbol.for("herdr-agent-report-seq");
function nextSeq(): number {
  const seq = ((globalThis as Record<symbol, number>)[SEQ_KEY] ?? 0) + 1;
  (globalThis as Record<symbol, number>)[SEQ_KEY] = seq;
  return seq;
}

export const piExtension = { id: "herdr-agent-report" };

export default function (pi: ExtensionAPI) {
  const herdrPaneId = process.env.HERDR_PANE_ID;
  const inHerdr = Boolean(process.env.HERDR_ENV && herdrPaneId);

  if (!inHerdr || !herdrPaneId) return;
  const paneId = herdrPaneId;

  let lastState: HerdrAgentState | undefined;

  async function report(state: HerdrAgentState, message?: string) {
    if (lastState === state && !message) return;
    lastState = state;
    const seq = nextSeq();

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
        console.warn(`[herdr-agent-report] report ${state} failed: ${result.stderr || result.stdout}`);
      }
    } catch (error) {
      console.warn(`[herdr-agent-report] report ${state} failed:`, error);
    }
  }

  async function release() {
    const seq = nextSeq();
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

  // Only release on actual quit. Session switches (/new, /resume, /fork, /reload)
  // keep the agent registered; the new session_start updates the state in place.
  pi.on("session_shutdown", async (event) => {
    if (event.reason === "quit") {
      await release();
    }
  });

  let piSettings: CapabilityVisibilitySettings = {};
  const visibilityResult = loadCapabilityVisibilitySettings();
  for (const warning of visibilityResult.warnings) {
    console.warn(`[herdr-agent-report] capability-visibility: ${warning.message}`);
  }
  piSettings = visibilityResult.settings;
  const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

  managed.registerCommand("herdr-agent", {
    description: "Report this Pi pane to Herdr as idle, working, blocked, unknown, or release it",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
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
