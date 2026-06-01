import type { ReactNode, RefObject } from "react";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  applyMarkdownToTextarea,
  insertBold,
  insertBulletList,
  insertCodeFence,
  insertHeading,
  insertInlineCode,
  insertItalic,
  insertLink,
  insertOrderedList,
  insertQuote,
  insertStrikethrough,
} from "@/lib/markdownEditor";
import { cn } from "@/lib/utils";

interface MarkdownEditorToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** e.g. sync @mention detection with new caret */
  onAfterChange?: (value: string, caret: number) => void;
  className?: string;
}

function Tb({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-muted-foreground",
            "hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none",
          )}
          aria-label={label}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function MarkdownEditorToolbar({
  textareaRef,
  value,
  onChange,
  disabled,
  onAfterChange,
  className,
}: MarkdownEditorToolbarProps) {
  const run = (edit: Parameters<typeof applyMarkdownToTextarea>[3]) => {
    const el = textareaRef.current;
    if (!el || disabled) return;
    applyMarkdownToTextarea(el, value, onChange, edit, onAfterChange);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-muted/40 px-1 py-0.5",
          className,
        )}
        role="toolbar"
        aria-label="Форматирование Markdown"
      >
        <Tb label="Жирный" disabled={disabled} onClick={() => run(insertBold)}>
          <Bold size={14} />
        </Tb>
        <Tb label="Курсив" disabled={disabled} onClick={() => run(insertItalic)}>
          <Italic size={14} />
        </Tb>
        <Tb label="Зачёркнутый" disabled={disabled} onClick={() => run(insertStrikethrough)}>
          <Strikethrough size={14} />
        </Tb>
        <Tb label="Код (строка)" disabled={disabled} onClick={() => run(insertInlineCode)}>
          <Code size={14} />
        </Tb>
        <Tb label="Ссылка" disabled={disabled} onClick={() => run(insertLink)}>
          <Link2 size={14} />
        </Tb>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <Tb label="Заголовок 2" disabled={disabled} onClick={() => run((v, s, e) => insertHeading(v, s, e, 2))}>
          <Heading2 size={14} />
        </Tb>
        <Tb label="Заголовок 3" disabled={disabled} onClick={() => run((v, s, e) => insertHeading(v, s, e, 3))}>
          <Heading3 size={14} />
        </Tb>
        <Tb label="Цитата" disabled={disabled} onClick={() => run(insertQuote)}>
          <Quote size={14} />
        </Tb>
        <Tb label="Маркированный список" disabled={disabled} onClick={() => run(insertBulletList)}>
          <List size={14} />
        </Tb>
        <Tb label="Нумерованный список" disabled={disabled} onClick={() => run(insertOrderedList)}>
          <ListOrdered size={14} />
        </Tb>
        <Tb label="Блок кода" disabled={disabled} onClick={() => run(insertCodeFence)}>
          <span className="font-mono text-[10px] leading-none">{"{}"}</span>
        </Tb>
      </div>
    </TooltipProvider>
  );
}
