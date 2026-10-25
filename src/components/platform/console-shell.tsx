"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { useSession } from "@/lib/platform/session";
import { cn } from "@/lib/utils";

const items = [
  { href: "/console", key: "overview", group: "desk", operator: false },
  { href: "/console/insights", key: "insights", group: "desk", operator: false },
  { href: "/console/audit-logs", key: "audit", group: "desk", operator: false },
  { href: "/console/query", key: "query", group: "desk", operator: false },
  { href: "/console/rules", key: "rules", group: "policy", operator: false },
  { href: "/console/templates", key: "templates", group: "policy", operator: true },
  { href: "/console/labels", key: "labels", group: "policy", operator: true },
  { href: "/console/variables", key: "variables", group: "policy", operator: true },
  { href: "/console/workflows", key: "workflows", group: "policy", operator: true },
  { href: "/console/capabilities", key: "capabilities", group: "detect", operator: true },
  { href: "/console/tuning", key: "tuning", group: "detect", operator: true },
  { href: "/console/knowledge", key: "knowledge", group: "detect", operator: true },
  { href: "/console/samples", key: "samples", group: "detect", operator: true },
  { href: "/console/llm-lab", key: "llmLab", group: "detect", operator: true },
  { href: "/console/intercept", key: "intercept", group: "detect", operator: false },
  { href: "/console/lab", key: "lab", group: "detect", operator: false },
  { href: "/console/releases", key: "releases", group: "detect", operator: true },
  { href: "/console/org", key: "org", group: "org", operator: true },
  { href: "/console/tasks", key: "tasks", group: "org", operator: true },
  { href: "/console/settings", key: "settings", group: "org", operator: false },
] as const;

const groups = ["desk", "policy", "detect", "org"] as const;
type NavGroup = (typeof groups)[number];

const navStorageKey = "aegis_nav_groups_v1";
const defaultOpen: Record<NavGroup, boolean> = { desk: true, policy: true, detect: true, org: true };

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Console");
  const ops = useTranslations("Ops");
  const site = useTranslations("Site");
  const pathname = usePathname();
  const { session, clear } = useSession();
  const visible = items.filter((item) => !item.operator || session?.role !== "customer");
  const [open, setOpen] = useState<Record<NavGroup, boolean>>(defaultOpen);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(navStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<NavGroup, boolean>>;
      setOpen({ ...defaultOpen, ...parsed });
    } catch {
      setOpen(defaultOpen);
    }
  }, []);

  function toggleGroup(group: NavGroup) {
    setOpen((current) => {
      const next = { ...current, [group]: !current[group] };
      sessionStorage.setItem(navStorageKey, JSON.stringify(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 bg-zinc-950 text-zinc-300 md:flex md:flex-col">
          <Link href="/" className="flex items-center gap-2 px-4 py-4">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white text-zinc-950">
              <Shield className="size-4" />
            </span>
            <span>
              <span className="block text-base font-semibold text-white">{site("brand")}</span>
              <span className="block text-xs text-zinc-500">{t("internal")}</span>
            </span>
          </Link>
          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-6">
            {groups.map((group) => {
              const links = visible.filter((item) => item.group === group);
              if (links.length === 0) return null;
              return (
                <div key={group}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-2 py-1 text-sm font-semibold text-zinc-100"
                    aria-expanded={open[group]}
                    onClick={() => toggleGroup(group)}
                  >
                    {t(`groups.${group}`)}
                    {open[group] ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronRight className="size-4 text-zinc-400" />}
                  </button>
                  {open[group] ? <div className="flex flex-col gap-0.5">
                    {links.map((item) => {
                      const active =
                        item.href === "/console"
                          ? pathname === "/console"
                          : item.href === "/console/rules"
                            ? pathname.startsWith("/console/rules") || pathname.startsWith("/console/libraries")
                            : pathname.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "rounded-md px-3 py-1 text-xs",
                            active ? "bg-white/10 font-medium text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                          )}
                        >
                          {t(`nav.${item.key}`)}
                        </Link>
                      );
                    })}
                  </div> : null}
                </div>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3">
            <p className="text-sm text-zinc-500">{t("accessNotice")}</p>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700">
                {session
                  ? `${session.role === "customer" ? ops("customer") : ops("operator")} · ${session.tenantId}`
                  : ops("unsigned")}
              </span>
              {session ? (
                <Button size="sm" variant="outline" onClick={clear}>
                  {ops("signOut")}
                </Button>
              ) : null}
              <LanguageSwitcher tone="light" />
            </div>
          </header>
          <div className="space-y-2 border-b border-zinc-200 bg-white px-4 py-2 md:hidden">
            {groups.map((group) => {
              const links = visible.filter((item) => item.group === group);
              if (links.length === 0) return null;
              return (
                <div key={group}>
                  <button type="button" className="text-sm font-semibold text-zinc-800" onClick={() => toggleGroup(group)}>
                    {t(`groups.${group}`)} {open[group] ? "−" : "+"}
                  </button>
                  {open[group] ? (
                    <div className="mt-1 flex gap-2 overflow-x-auto">
                      {links.map((item) => (
                        <Link key={item.href} href={item.href} className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600">
                          {t(`nav.${item.key}`)}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="px-4 py-5 sm:px-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
