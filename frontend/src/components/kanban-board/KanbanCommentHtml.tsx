import { useMemo } from "react";
import DOMPurify from "dompurify";

let linkHookInstalled = false;

function installExternalLinkHook() {
  if (typeof window === "undefined" || linkHookInstalled) return;
  linkHookInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A" || !(node instanceof HTMLAnchorElement)) return;
    const href = node.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("/")) return;
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute("target", "_blank");
      const rel = (node.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean);
      if (!rel.includes("noopener")) rel.push("noopener");
      if (!rel.includes("noreferrer")) rel.push("noreferrer");
      node.setAttribute("rel", [...new Set(rel)].join(" "));
    }
  });
}

export function KanbanCommentHtml({ html, className }: { html: string; className?: string }) {
  installExternalLinkHook();

  const safe = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
      }),
    [html],
  );

  if (!safe.trim()) {
    return null;
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
