import type { Theme } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, SelectList, Spacer, Text, visibleWidth, type SelectItem } from "@earendil-works/pi-tui";

export function centerText(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth >= width) return text;
  return " ".repeat(Math.floor((width - textWidth) / 2)) + text;
}

export function wrapInBox(lines: string[], theme: Theme, width: number): string[] {
  const w = Math.min(width, 120);
  const innerW = w - 2;
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const bordered = (content: string) => theme.fg("border", "│") + pad(content) + theme.fg("border", "│");
  return [
    theme.fg("border", `╭${"─".repeat(innerW)}╮`),
    ...lines.map(bordered),
    theme.fg("border", `╰${"─".repeat(innerW)}╯`),
  ];
}

export class BoxedPicker extends Container {
  private readonly selectList: SelectList;
  private readonly theme: Theme;

  constructor(
    theme: Theme,
    title: string,
    items: SelectItem[],
    selectedValue: string,
    onPick: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.theme = theme;
    this.addChild(new Text(centerText(theme.fg("accent", theme.bold(title)), 120), 0, 0));
    this.addChild(new Spacer(1));
    this.selectList = new SelectList(items, items.length, getSelectListTheme());
    const index = items.findIndex((item) => item.value === selectedValue);
    if (index >= 0) this.selectList.setSelectedIndex(index);
    this.selectList.onSelect = (item) => onPick(item.value);
    this.selectList.onCancel = onCancel;
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    this.addChild(new Text(centerText(theme.fg("dim", "Enter selects. Esc closes."), 120), 0, 0));
  }

  render(width: number): string[] {
    return wrapInBox(super.render(width), this.theme, width);
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

export class TextPrompt extends Container {
  private readonly input = new Input();
  private finished = false;
  private readonly theme: Theme;

  constructor(
    theme: Theme,
    title: string,
    initial: string,
    onSubmit: (value: string) => void,
    onCancel: () => void,
  ) {
    super();
    this.theme = theme;
    const finish = (value: string | undefined) => {
      if (this.finished) return;
      this.finished = true;
      if (value === undefined) onCancel();
      else onSubmit(value);
    };
    this.addChild(new Text(centerText(theme.fg("accent", theme.bold(title)), 120), 0, 0));
    this.addChild(new Spacer(1));
    this.input.setValue(initial);
    this.input.onSubmit = (value) => finish(value);
    this.input.onEscape = () => finish(undefined);
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(new Text(centerText(theme.fg("dim", "Enter saves. Esc goes back."), 120), 0, 0));
  }

  render(width: number): string[] {
    return wrapInBox(super.render(width), this.theme, width);
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }
}
