import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

import { cn } from "@/lib/utils";

const DISALLOWED_TAGS = new Set(["table", "thead", "tbody", "tr", "th", "td", "input", "img"]);

function ticketSanitizeSchema() {
  const tagNames = (defaultSchema.tagNames ?? []).filter((t) => !DISALLOWED_TAGS.has(String(t)));
  return { ...defaultSchema, tagNames };
}

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const t = href.trim();
  const lower = t.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return undefined;
  }
  if (t.startsWith("/#/") || (t.startsWith("/") && !t.startsWith("//"))) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return undefined;
}

const markdownComponents: Partial<Components> = {
  a({ href, children, ...props }) {
    const h = safeHref(typeof href === "string" ? href : undefined);
    if (!h) return <span className="text-foreground">{children}</span>;
    const external = /^https?:\/\//i.test(h);
    return (
      <a
        href={h}
        className="text-primary underline-offset-2 hover:underline"
        {...props}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },
};

export function TicketMarkdown({
  markdown,
  className,
  emptyFallback,
}: {
  markdown: string;
  className?: string;
  /** When markdown is empty or whitespace-only */
  emptyFallback?: ReactNode;
}) {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return <>{emptyFallback ?? null}</>;
  }
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none text-foreground/90",
        "prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2",
        "prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:whitespace-pre prose-pre:bg-muted prose-pre:text-foreground prose-pre:border prose-pre:border-border",
        "prose-code:break-words prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, ticketSanitizeSchema()]]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
