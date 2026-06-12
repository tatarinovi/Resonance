import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Check, Bold, Italic, Underline, Strikethrough, Code2, Link2 } from "lucide-react";

import { getAvatarInfo } from "./avatars";

export function Avatar({ initials, color, size = 22, title }: { initials: string; color: string; size?: number; title?: string }) {
  const tooltip = title ?? initials;
  return (
    <div
      className="avatar group/avatar relative select-none"
      aria-label={tooltip}
      style={{
        background: color + "30",
        color,
        borderColor: "var(--kanban-surface)",
        width: size,
        height: size,
        fontSize: size * 0.41,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "2px solid transparent",
      }}
      data-testid={`img-avatar-${initials}`}
    >
      {initials}
      <span className="pointer-events-none absolute left-1/2 top-0 z-50 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-[var(--kanban-border)] bg-[var(--kanban-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--kanban-text)] opacity-0 shadow-lg transition-opacity duration-150 group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100">
        {tooltip}
      </span>
    </div>
  );
}

export function RteToolbar() {
  return (
    <div className="rte-toolbar" data-testid="toolbar-rte">
      {[Bold, Italic, Underline, Strikethrough, Code2, Link2].map((Icon, i) => (
        <button key={i} type="button" className="rte-btn" data-testid={`button-rte-format-${i}`}>
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      role="button"
      tabIndex={0}
      data-testid={`toggle-${label}`}
    >
      <div
        style={{
          width: 28,
          height: 16,
          borderRadius: 8,
          border: `1px solid ${on ? "var(--kanban-accent)" : "var(--kanban-border)"}`,
          background: on ? "rgba(139,92,246,0.25)" : "var(--kanban-surface-2)",
          position: "relative",
          flexShrink: 0,
          transition: "all 0.15s",
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            position: "absolute",
            top: 2,
            left: on ? 14 : 2,
            background: on ? "var(--kanban-accent)" : "var(--kanban-text-faint)",
            transition: "all 0.15s",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: on ? "var(--kanban-text)" : "var(--kanban-text-muted)" }}>{label}</span>
    </div>
  );
}

export function MSelect({
  label,
  options,
  value,
  onChange,
  required,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div className="mfield" data-testid={`select-${label}`}>
      <label className="mfield-label">
        {label}
        {required && <span style={{ color: "var(--kanban-danger)", marginLeft: 2 }}>*</span>}
      </label>
      <div style={{ position: "relative" }}>
        <select
          className="mfield-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`input-select-${label}`}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--kanban-text-muted)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

export function MInput({
  label,
  placeholder,
  required,
  type,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="mfield" data-testid={`input-group-${label}`}>
      <label className="mfield-label">
        {label}
        {required && <span style={{ color: "var(--kanban-danger)", marginLeft: 2 }}>*</span>}
      </label>
      <input
        className="mfield-input"
        placeholder={placeholder || label}
        type={type || "text"}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        data-testid={`input-${label}`}
      />
    </div>
  );
}

export function FilterDropdown({
  label,
  icon: Icon,
  options,
  selected,
  onToggle,
  searchable = false,
  searchPlaceholder = "Поиск",
  emptySearchMessage = "Никого не найдено",
  emptyOptionsMessage,
  /** Если задан - фильтрация опций по строке поиска (например, поиск по id эпика). */
  matchOption,
  /** Стабильный ключ React для опции (по умолчанию - сама строка опции). */
  getOptionReactKey,
}: {
  label: string;
  icon: React.ElementType;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Текст, если поиск не дал совпадений (для не-пользовательских списков). */
  emptySearchMessage?: string;
  /** Текст, если список опций пуст (например, нет эпиков в проекте). */
  emptyOptionsMessage?: string;
  matchOption?: (option: string, queryNormalized: string) => boolean;
  getOptionReactKey?: (option: string, index: number) => React.Key;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  const visibleOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!searchable || !q) return options;
    const matcher =
      matchOption ??
      ((o: string, query: string) => {
        return o.toLowerCase().includes(query);
      });
    return options.filter((o) => matcher(o, q));
  }, [options, searchQuery, searchable, matchOption]);

  const activeCount = selected.length;

  return (
    <div style={{ position: "relative" }} ref={ref} data-testid={`dropdown-${label}`}>
      <button
        type="button"
        className="toolbar-btn"
        onClick={() => setOpen((o) => !o)}
        style={activeCount > 0 ? { borderColor: "var(--kanban-accent)", color: "var(--kanban-accent-emphasis)", background: "var(--kanban-accent-soft)" } : {}}
        data-testid={`button-toggle-${label}`}
      >
        <Icon size={12} /> {label}
        {activeCount > 0 && (
          <span
            style={{
              background: "var(--kanban-accent)",
              color: "#fff",
              borderRadius: 10,
              padding: "0 5px",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            {activeCount}
          </span>
        )}
        <ChevronDown
          size={10}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 200,
            background: "var(--kanban-surface-2)",
            border: "1px solid var(--kanban-border)",
            borderRadius: 4,
            minWidth: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
          data-testid={`menu-${label}`}
        >
          {searchable && (
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--kanban-border)" }}>
              <input
                type="search"
                className="mfield-input"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                style={{ width: "100%", fontSize: 12, padding: "6px 8px" }}
                data-testid={`dropdown-search-${label}`}
              />
            </div>
          )}
          {options.length === 0 ? (
            emptyOptionsMessage ? (
              <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--kanban-text-muted)" }}>{emptyOptionsMessage}</div>
            ) : null
          ) : (
            <>
              {visibleOptions.map((opt, optIndex) => (
                <div
                  key={getOptionReactKey ? getOptionReactKey(opt, optIndex) : opt}
                  onClick={() => onToggle(opt)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggle(opt);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 12px",
                    cursor: "pointer",
                    fontSize: 13,
                    color: selected.includes(opt) ? "var(--kanban-text)" : "var(--kanban-text-muted)",
                    background: selected.includes(opt) ? "var(--kanban-accent-soft)" : "transparent",
                    transition: "all 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!selected.includes(opt)) (e.currentTarget as HTMLDivElement).style.background = "var(--kanban-hover)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = selected.includes(opt)
                      ? "var(--kanban-accent-soft)"
                      : "transparent";
                  }}
                  data-testid={`option-${opt}`}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 2,
                      border: `1px solid ${selected.includes(opt) ? "var(--kanban-accent)" : "var(--kanban-border)"}`,
                      background: selected.includes(opt) ? "var(--kanban-accent)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {selected.includes(opt) && <Check size={10} color="#fff" />}
                  </div>
                  {opt}
                </div>
              ))}
              {searchable && visibleOptions.length === 0 && (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--kanban-text-muted)" }}>{emptySearchMessage}</div>
              )}
            </>
          )}
          {selected.length > 0 && (
            <div style={{ padding: "6px 12px", borderTop: "1px solid var(--kanban-border)" }}>
              <button
                type="button"
                onClick={() => {
                  selected.forEach((s) => onToggle(s));
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--kanban-danger)",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                }}
                data-testid={`button-reset-${label}`}
              >
                Сбросить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { getAvatarInfo };
