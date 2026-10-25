"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Shield } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Field, PrototypeBanner, SimpleSelect } from "@/components/platform/ui";
import { useSession, type SessionRole } from "@/lib/platform/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";

type Mode = "login" | "register" | "forgot";

export function AuthView({ mode }: { mode: Mode }) {
  const t = useTranslations("Auth");
  const ops = useTranslations("Ops");
  const site = useTranslations("Site");
  const { save } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SessionRole>("customer");
  const [tenantId, setTenantId] = useState("ten_demo");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: string[] = [];
    if (mode === "register" && !name.trim()) next.push("name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.push("email");
    if (mode !== "forgot" && password.length < 8) next.push("password");
    if (mode === "register" && password !== confirm) next.push("confirm");
    setErrors(next);
    if (next.length === 0 && mode !== "forgot") {
      save({ role, tenantId, email: email.trim() });
    }
    setDone(next.length === 0);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="mx-auto flex h-16 max-w-lg items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Shield className="size-4" />
          </span>
          {site("brand")}
        </Link>
        <LanguageSwitcher tone="light" />
      </header>
      <div className="mx-auto max-w-lg px-4 pb-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-2xl font-semibold">{t(`${mode}.title`)}</h1>
          <p className="mt-2 text-sm text-slate-600">{t(`${mode}.description`)}</p>
          <div className="mt-4">
            <PrototypeBanner>{t("notConnected")}</PrototypeBanner>
          </div>
          {done ? (
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <p className="font-medium text-slate-950">{t(`${mode}.successTitle`)}</p>
              <p>{t(`${mode}.successBody`)}</p>
              <Link
                href="/console"
                className="inline-flex h-8 items-center rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white"
              >
                {t("openConsole")}
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
              {mode === "register" ? (
                <Field label={t("name")} error={errors.includes("name") ? t("nameError") : undefined}>
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
              ) : null}
              <Field label={t("email")} error={errors.includes("email") ? t("emailError") : undefined}>
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
              {mode !== "forgot" ? (
                <>
                  <Field label={ops("role")}>
                    <SimpleSelect
                      value={role}
                      onChange={(value) => setRole(value as SessionRole)}
                      options={[
                        { value: "customer", label: ops("customer") },
                        { value: "operator", label: ops("operator") },
                      ]}
                    />
                  </Field>
                  <Field label={ops("tenant")}>
                    <SimpleSelect
                      value={tenantId}
                      onChange={setTenantId}
                      options={[
                        { value: "ten_demo", label: ops("tenantDemo") },
                        { value: "ten_retail", label: ops("tenantRetail") },
                      ]}
                    />
                  </Field>
                </>
              ) : null}
              {mode !== "forgot" ? (
                <Field
                  label={t("password")}
                  error={errors.includes("password") ? t("passwordError") : undefined}
                >
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>
              ) : null}
              {mode === "register" ? (
                <Field
                  label={t("confirm")}
                  error={errors.includes("confirm") ? t("confirmError") : undefined}
                >
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>
              ) : null}
              <Button type="submit" className="w-full">
                {t(`${mode}.submit`)}
              </Button>
            </form>
          )}
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-blue-700">
            {mode !== "login" ? <Link href="/login">{t("toLogin")}</Link> : null}
            {mode !== "register" ? <Link href="/register">{t("toRegister")}</Link> : null}
            {mode !== "forgot" ? <Link href="/forgot-password">{t("toForgot")}</Link> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
