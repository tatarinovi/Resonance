/** Helpers to insert Markdown around the textarea selection (or placeholders). */

export interface MarkdownEditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function lineRange(value: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  let lineStart = start;
  while (lineStart > 0 && value[lineStart - 1] !== "\n") lineStart -= 1;
  let lineEnd = end;
  while (lineEnd < value.length && value[lineEnd] !== "\n") lineEnd += 1;
  return { lineStart, lineEnd };
}

export function wrapMarkdown(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  emptyPlaceholder?: string,
): MarkdownEditResult {
  const selected = value.slice(start, end);
  if (
    selected &&
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    const next = `${value.slice(0, start - before.length)}${selected}${value.slice(end + after.length)}`;
    return {
      value: next,
      selectionStart: start - before.length,
      selectionEnd: end - before.length,
    };
  }
  const inner = selected || (emptyPlaceholder ?? "");
  const next = `${value.slice(0, start)}${before}${inner}${after}${value.slice(end)}`;
  const selStart = start + before.length;
  const selEnd = selStart + inner.length;
  return { value: next, selectionStart: selStart, selectionEnd: selEnd };
}

export function insertBold(value: string, start: number, end: number): MarkdownEditResult {
  return wrapMarkdown(value, start, end, "**", "**", "жирный");
}

export function insertItalic(value: string, start: number, end: number): MarkdownEditResult {
  return wrapMarkdown(value, start, end, "_", "_", "курсив");
}

export function insertStrikethrough(value: string, start: number, end: number): MarkdownEditResult {
  return wrapMarkdown(value, start, end, "~~", "~~", "зачёркнутый");
}

export function insertInlineCode(value: string, start: number, end: number): MarkdownEditResult {
  return wrapMarkdown(value, start, end, "`", "`", "код");
}

export function insertLink(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end);
  if (selected.trim()) {
    return wrapMarkdown(value, start, end, "[", "](https://)", undefined);
  }
  const chunk = "[текст](https://)";
  const next = `${value.slice(0, start)}${chunk}${value.slice(end)}`;
  const open = start + 1;
  return { value: next, selectionStart: open, selectionEnd: open + 5 };
}

export function insertHeading(value: string, start: number, end: number, level: 2 | 3): MarkdownEditResult {
  const prefix = level === 2 ? "## " : "### ";
  const { lineStart, lineEnd } = lineRange(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  lines[0] = lines[0].startsWith(prefix) ? lines[0].slice(prefix.length) : `${prefix}${lines[0]}`;
  const newBlock = lines.join("\n");
  const next = `${value.slice(0, lineStart)}${newBlock}${value.slice(lineEnd)}`;
  const cursor = lineStart + newBlock.length;
  return { value: next, selectionStart: cursor, selectionEnd: cursor };
}

export function prefixLines(
  value: string,
  start: number,
  end: number,
  linePrefix: string,
): MarkdownEditResult {
  const { lineStart, lineEnd } = lineRange(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const populated = lines.filter((line) => line.length > 0);
  const shouldRemove = populated.length > 0 && populated.every((line) => line.startsWith(linePrefix));
  const nextLines = lines.map((line) => {
    if (!line.length) return line;
    return shouldRemove ? line.slice(linePrefix.length) : `${linePrefix}${line}`;
  });
  const next = `${value.slice(0, lineStart)}${nextLines.join("\n")}${value.slice(lineEnd)}`;
  const added = nextLines.join("\n").length - block.length;
  return {
    value: next,
    selectionStart: lineStart,
    selectionEnd: lineEnd + added,
  };
}

export function insertBulletList(value: string, start: number, end: number): MarkdownEditResult {
  return prefixLines(value, start, end, "- ");
}

export function insertOrderedList(value: string, start: number, end: number): MarkdownEditResult {
  return prefixLines(value, start, end, "1. ");
}

export function insertQuote(value: string, start: number, end: number): MarkdownEditResult {
  return prefixLines(value, start, end, "> ");
}

export function insertCodeFence(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end);
  if (selected && value.slice(start - 4, start) === "```\n" && value.slice(end, end + 4) === "\n```") {
    const next = `${value.slice(0, start - 4)}${selected}${value.slice(end + 4)}`;
    return { value: next, selectionStart: start - 4, selectionEnd: end - 4 };
  }
  const body = selected.trim() ? selected : "код";
  const fence = `\`\`\`\n${body}\n\`\`\`\n`;
  const next = `${value.slice(0, start)}${fence}${value.slice(end)}`;
  const innerStart = start + 4;
  const innerEnd = innerStart + body.length;
  return { value: next, selectionStart: innerStart, selectionEnd: innerEnd };
}

export function applyMarkdownToTextarea(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (next: string) => void,
  edit: (value: string, start: number, end: number) => MarkdownEditResult,
  onAfterChange?: (next: string, caret: number) => void,
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const { value: next, selectionStart, selectionEnd } = edit(value, start, end);
  const proto = window.HTMLTextAreaElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (valueSetter) {
    valueSetter.call(textarea, next);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    onChange(next);
  }
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
    onAfterChange?.(next, selectionEnd);
  });
}
