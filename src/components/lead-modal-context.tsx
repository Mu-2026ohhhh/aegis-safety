"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LeadForm, type LeadIntent } from "@/components/LeadForm";

type LeadModalContextValue = {
  openLead: (intent?: LeadIntent) => void;
  closeLead: () => void;
};

const LeadModalContext = createContext<LeadModalContextValue | null>(null);

export function LeadModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<LeadIntent>("demo");

  const openLead = useCallback((next: LeadIntent = "demo") => {
    setIntent(next);
    setOpen(true);
  }, []);

  const closeLead = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ openLead, closeLead }),
    [openLead, closeLead]
  );

  return (
    <LeadModalContext.Provider value={value}>
      {children}
      <LeadForm
        open={open}
        onOpenChange={setOpen}
        defaultIntent={intent}
        key={intent}
      />
    </LeadModalContext.Provider>
  );
}

export function useLeadModal() {
  const ctx = useContext(LeadModalContext);
  if (!ctx) {
    throw new Error("useLeadModal must be used within LeadModalProvider");
  }
  return ctx;
}
