import { ANIMATION_ENABLED } from "./constants.js";
import type { AnimationMode, SimpleTheme } from "./types.js";
import type { MascotTonePalette } from "./constants.js";
import { positiveModulo } from "./utils.js";

export type AsciiAnimationStyle = "static" | "animated";

// Render a hex color directly to truecolor ANSI. Used for mascot tones that
// are stored as raw hex values (not as Pi theme color keys) because they
// live in the theme's `vars` block, which `theme.fg()` cannot resolve.
function fgHex(hex: string, text: string): string {
	const cleaned = hex.replace("#", "");
	if (cleaned.length !== 6) return text;
	const r = parseInt(cleaned.substring(0, 2), 16);
	const g = parseInt(cleaned.substring(2, 4), 16);
	const b = parseInt(cleaned.substring(4, 6), 16);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return text;
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function applyToneColor(
	theme: SimpleTheme,
	color: string,
	text: string,
): string {
	return color.startsWith("#") ? fgHex(color, text) : theme.fg(color, text);
}

const ANIMATION_OVERRIDE_MAP: Record<string, AnimationMode> = {
	"0": "off",
	"1": "continuous",
	off: "off",
	on: "continuous",
	intro: "intro",
	continuous: "continuous",
};

function getAnimationOverrideMode(
	override: string | undefined,
): AnimationMode | undefined {
	return override ? ANIMATION_OVERRIDE_MAP[override] : undefined;
}

export function asciiAnimationMode(): AnimationMode {
	if (!ANIMATION_ENABLED) return "off";
	return getAnimationOverrideMode(process.env.OSDY_PI_ANIMATION) ?? "intro";
}

function getAnimatedAsciiColor(
	wave: number,
	baseColor: string,
	highlightColor: string,
	trailColor: string,
): string {
	if (wave <= 3) return highlightColor;
	if (wave <= 8) return trailColor;
	return baseColor;
}

export function animateAsciiLine(
	line: string,
	lineIndex: number,
	frame: number,
	theme: SimpleTheme,
	baseColor: string,
	highlightColor: string,
	trailColor: string,
	style: AsciiAnimationStyle,
): string {
	if (style === "static") return theme.fg(baseColor, line);
	return Array.from(line)
		.map((char, charIndex) => {
			if (char === " ") return char;
			const wave = positiveModulo(charIndex + lineIndex * 2 - frame * 5, 44);
			return theme.fg(
				getAnimatedAsciiColor(wave, baseColor, highlightColor, trailColor),
				char,
			);
		})
		.join("");
}

export function animateAsciiLineWithToneMap(
	line: string,
	toneMap: string,
	lineIndex: number,
	frame: number,
	theme: SimpleTheme,
	palette: MascotTonePalette,
	style: AsciiAnimationStyle,
): string {
	return Array.from(line)
		.map((char, charIndex) => {
			if (char === " ") return char;
			const tone = toneMap[charIndex];
			if (
				tone !== "b" &&
				tone !== "h" &&
				tone !== "l" &&
				tone !== "m" &&
				tone !== "d" &&
				tone !== "p" &&
				tone !== "c" &&
				tone !== "v"
			) {
				return char;
			}
			const baseColor = palette[tone];
			if (style === "static") return applyToneColor(theme, baseColor, char);
			const wave = positiveModulo(charIndex + lineIndex * 2 - frame * 5, 44);
			const highlightColor =
				tone === "b" || tone === "h" || tone === "p" ? palette.h : palette.l;
			const trailColor = tone === "d" ? palette.m : palette.b;
			return applyToneColor(
				theme,
				getAnimatedAsciiColor(wave, baseColor, highlightColor, trailColor),
				char,
			);
		})
		.join("");
}
