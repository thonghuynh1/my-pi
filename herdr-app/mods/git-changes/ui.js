// Presentation only: an adaptive, Apple-inspired palette, never status inference.
export function palette(tokens = {}) {
  const rgb = /^#([\da-f]{6})/i.exec(tokens.background || tokens.canvas || "#202020")?.[1] || "202020";
  const [r, g, b] = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16));
  const dark = .2126 * r + .7152 * g + .0722 * b < 145;
  const colors = dark ? {
    canvas: "#1c1d22", card: "#292b32", inset: "#22242b", stroke: "#3b3e48", hover: "#333743",
    text: "#f5f5f7", secondary: "#b3b7c3", muted: "#9298a8",
    blue: "#8ac0ff", blueWash: "#233d60", green: "#8bdfad", greenWash: "#233e31",
    orange: "#ffd08a", orangeWash: "#493821", red: "#ffb3af", redWash: "#4b2b30",
    purple: "#d2b7ff", purpleWash: "#3b3052", pink: "#ffb0d1", pinkWash: "#492d3f",
    heroStart: "#263b5c", heroEnd: "#32304b", action: "#006bdf", actionHover: "#0064d5",
  } : {
    canvas: "#f2f3f7", card: "#ffffff", inset: "#e9ecf2", stroke: "#d6dae4", hover: "#edf1f8",
    text: "#1d2130", secondary: "#515969", muted: "#626b7e",
    blue: "#075bb5", blueWash: "#e1eeff", green: "#216a3c", greenWash: "#e1f3e7",
    orange: "#854800", orangeWash: "#fff0d9", red: "#a5282e", redWash: "#ffe6e6",
    purple: "#6740a2", purpleWash: "#eee6ff", pink: "#a32c69", pinkWash: "#ffe4f1",
    heroStart: "#e4f0ff", heroEnd: "#eee8ff", action: "#0066d6", actionHover: "#0054b5",
  };
  return { ...colors, dark, white: "#ffffff" };
}

export function statusTone(color) {
  return ({ ansi2: "green", blocked: "red", working: "orange" })[color] || "secondary";
}

export function authorInitials(login = "") {
  const words = login.replace(/^@/, "").split(/[-_\s]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}

export function authorTone(login = "") {
  let hash = 0;
  for (const char of login.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["blue", "purple", "pink", "green", "orange"][hash % 5];
}
