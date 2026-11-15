// Opens a file in a viewer tab of a space, reusing the tab that already shows it.
// tab.new returns nothing, so the new tab is found by diffing the space's tabs.
import { spaces, panes, shared, setShared, run } from "herdr";

const KEY = "files-open-with.tabs";
let pending = null;

const alive = tab => panes().some(p => p.tab === tab && p.mod === "files-open-with");
const tabIds = space => new Set(spaces().find(s => s.id === space)?.tabs.map(t => t.id) ?? []);

export function openFile({ file, on = null, space }, cx) {
  const key = `${space}|${on ?? ""}|${file}`, tab = (shared(KEY) ?? {})[key];
  if (tab && alive(tab)) return run("tab.select", { id: tab });
  pending = { key, space, before: tabIds(space) };
  run("tab.new", { name: file.split("/").pop(), ...(space ? { space } : {}), mod: "files-open-with", props: { role: "viewer", file, on } });
  track(cx, 40);
}

// Polls briefly until the new tab appears, then remembers it (dropping closed ones).
function track(cx, tries) {
  if (!pending) return;
  const { key, space, before } = pending;
  const made = [...tabIds(space)].find(id => !before.has(id) && alive(id));
  if (made) {
    const map = Object.fromEntries(Object.entries(shared(KEY) ?? {}).filter(([, t]) => alive(t)));
    pending = null;
    setShared(KEY, { ...map, [key]: made });
  } else if (tries > 0) cx.timer.after(50, cx => track(cx, tries - 1));
}
