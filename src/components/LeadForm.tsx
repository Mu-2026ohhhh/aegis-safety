"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type LeadIntent = "whitepaper" | "demo" | "analytics" | "sandbox";

type LeadFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultIntent?: LeadIntent;
  onSuccess?: () => void;
  title?: string;
  description?: string;
};

export function LeadForm({
  open,
  onOpenChange,
  defaultIntent = "demo",
  onSuccess,
  title,
  description,
}: LeadFormProps) {
  const t = useTranslations("LeadForm");
  const locale = useLocale();
  const [intent, setIntent] = useState<LeadIntent>(defaultIntent);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "lead",
          name: form.get("name"),
          email: form.get("email"),
          company: form.get("company"),
          intent,
          locale,
        }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setSubmitted(true);
      onSuccess?.();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setTimeout(() => {
        setSubmitted(false);
        setLoading(false);
        setFailed(false);
        setIntent(defaultIntent);
      }, 200);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-white/10 bg-slate-950/95 sm:max-w-md">
        {submitted ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/30">
              <CheckCircle2 className="size-6" />
            </div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl text-white">
                {t("successTitle")}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {t("successDescription")}
              </DialogDescription>
            </DialogHeader>
            <Button
              className="mt-2 bg-sky-500 text-white hover:bg-sky-400"
              onClick={() => handleOpenChange(false)}
            >
              {t("close")}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-xl text-white">
                {title ?? t("title")}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {description ?? t("description")}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="lead-name" className="text-slate-300">
                  {t("name")}
                </Label>
                <Input
                  id="lead-name"
                  name="name"
                  required
                  placeholder={t("namePlaceholder")}
                  className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lead-email" className="text-slate-300">
                  {t("email")}
                </Label>
                <Input
                  id="lead-email"
                  name="email"
                  type="email"
                  required
                  placeholder={t("emailPlaceholder")}
                  className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lead-company" className="text-slate-300">
                  {t("company")}
                </Label>
                <Input
                  id="lead-company"
                  name="company"
                  required
                  placeholder={t("companyPlaceholder")}
                  className="border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-slate-300">{t("intent")}</Label>
                <Select
                  value={intent}
                  onValueChange={(value) => setIntent(value as LeadIntent)}
                >
                  <SelectTrigger className="w-full border-white/10 bg-white/5 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
                    <SelectItem value="whitepaper">
                      {t("intentWhitepaper")}
                    </SelectItem>
                    <SelectItem value="demo">{t("intentDemo")}</SelectItem>
                    <SelectItem value="analytics">
                      {t("intentAnalytics")}
                    </SelectItem>
                    <SelectItem value="sandbox">{t("intentSandbox")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {failed ? <p className="text-sm text-rose-300">{t("error")}</p> : null}
            <DialogFooter className="border-white/10 bg-transparent p-0 sm:justify-stretch">
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-sky-500 to-indigo-500 text-white glow-btn hover:from-sky-400 hover:to-indigo-400"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("submitting")}
                  </>
                ) : (
                  t("submit")
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
