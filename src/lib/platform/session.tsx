"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "aegis_session_v1";

export type SessionRole = "operator" | "customer";

export type Session = {
  role: SessionRole;
  tenantId: string;
  email: string;
};

type SessionValue = {
  session: Session | null;
  ready: boolean;
  save: (session: Session) => void;
  clear: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.tenantId || (parsed.role !== "operator" && parsed.role !== "customer")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setReady(true);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      session,
      ready,
      save: (next) => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSession(next);
      },
      clear: () => {
        sessionStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
      },
    }),
    [ready, session]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}

export function OperatorGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const t = useTranslations("Ops");
  if (session?.role === "customer") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
        {t("operatorOnly")}
      </div>
    );
  }
  return children;
}
