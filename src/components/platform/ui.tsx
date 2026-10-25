"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Info, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "@/lib/platform/hash";
import { cn } from "@/lib/utils";

type ToastItem = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
};

const ToastContext = createContext<{
  notify: (toast: Omit<ToastItem, "id">) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const api = useMemo(
    () => ({
      notify: (toast: Omit<ToastItem, "id">) => {
        const id = Date.now() + Math.random();
        setItems((current) => [...current, { ...toast, id }]);
        window.setTimeout(() => {
          setItems((current) => current.filter((item) => item.id !== id));
        }, 4200);
      },
    }),
    []
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(100%-2rem,22rem)] flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "pointer-events-auto rounded-xl border bg-white p-3 shadow-lg",
              item.tone === "success" && "border-emerald-200",
              item.tone === "error" && "border-red-200",
              item.tone === "info" && "border-slate-200"
            )}
            role="status"
          >
            <div className="flex items-start gap-2">
              {item.tone === "success" ? (
                <Check className="mt-0.5 size-4 text-emerald-600" />
              ) : item.tone === "error" ? (
                <AlertTriangle className="mt-0.5 size-4 text-red-600" />
              ) : (
                <Info className="mt-0.5 size-4 text-blue-600" />
              )}
              <div>
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                {item.description ? (
                  <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider");
  return value;
}

export function useFormatters() {
  const locale = useLocale();
  return {
    locale,
    date: (iso: string) => formatDateTime(iso, locale),
    number: (value: number) => formatNumber(value, locale),
    percent: (value: number) => formatPercent(value, locale),
    bytes: (value: number) => formatBytes(value, locale),
  };
}

export function useScopeLabel() {
  const t = useTranslations("Enums");
  const scopes = t.raw("scopes") as Record<string, string>;
  return (id: string) => scopes[id] ?? id;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : null}
      {hint && !error ? <span className="block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function SimpleSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
      <SelectTrigger className={cn("w-full bg-white", className)}>
        <SelectValue>{options.find((option) => option.value === value)?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
}) {
  return (
    <div className="grid gap-2">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            value === option.value ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"
          )}
        >
          <input
            className="mt-0.5"
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <span className="font-medium text-slate-900">{option.label}</span>
            {option.hint ? (
              <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const t = useTranslations("Enums.status");
  const tone =
    value === "published" || value === "evaluation_passed" || value === "completed" || value === "enabled"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : value === "pending_release" || value === "evaluating" || value === "running" || value === "queued"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : value === "disabled" || value === "archived" || value === "rolled_back" || value === "cancelled"
          ? "bg-slate-100 text-slate-600 border-slate-200"
          : value === "failed" || value === "partially_failed"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-white text-slate-700 border-slate-200";
  return (
    <Badge variant="outline" className={cn("h-auto px-2 py-0.5", tone)}>
      {t(value as "draft")}
    </Badge>
  );
}

export function DecisionBadge({ value }: { value: string | null }) {
  const t = useTranslations("Enums.decision");
  if (!value) {
    return (
      <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">
        {t("none")}
      </Badge>
    );
  }
  const tone =
    value === "allow"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : value === "block"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <Badge variant="outline" className={tone}>
      {t(value as "allow")}
    </Badge>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBlock({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{description}</p>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("Site");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-slate-600">
      <span>
        {t("pageStatus", { page, pages, total })}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations("Site");
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label={t("close")}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex h-full w-full flex-col bg-white shadow-2xl",
          wide ? "max-w-2xl" : "max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("close")}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const t = useTranslations("Site");
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      notify({ tone: "success", title: t("copied") });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notify({ tone: "error", title: t("copyFailed") });
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs text-slate-400">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
        >
          <Copy className="size-3.5" />
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function PrototypeBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {children}
    </div>
  );
}

export function MockBadge() {
  const t = useTranslations("Site");
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
      {t("mockBadge")}
    </Badge>
  );
}

export function Disclosure({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0">
          <span className="text-sm font-medium text-zinc-900">{title}</span>
          {hint ? <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span> : null}
        </span>
        {open ? <ChevronDown className="size-4 shrink-0 text-slate-400" /> : <ChevronRight className="size-4 shrink-0 text-slate-400" />}
      </button>
      {open ? <div className="space-y-3 border-t border-slate-100 px-3 py-3">{children}</div> : null}
    </div>
  );
}

export function depthTitle(depth: number) {
  if (depth <= 0) return "text-base font-semibold tracking-tight text-zinc-950";
  if (depth === 1) return "text-sm font-medium text-zinc-800";
  if (depth === 2) return "text-[13px] font-normal text-zinc-700";
  return "text-xs font-normal text-zinc-600";
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-20 hidden w-max max-w-64 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white group-hover:block group-focus-within:block"
      >
        {content}
      </span>
    </span>
  );
}
