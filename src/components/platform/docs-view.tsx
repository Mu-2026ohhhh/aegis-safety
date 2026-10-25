"use client";

import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CodeBlock, PrototypeBanner, useFormatters } from "@/components/platform/ui";
import { Link, usePathname } from "@/i18n/navigation";
import { moderationLimits } from "@/lib/platform/limits";
import { contractExamples, prettyJson } from "@/lib/platform/moderation";
import { apiSnippets, errorCatalog } from "@/lib/platform/snippets";
import { cn } from "@/lib/utils";

const pages = [
  "overview",
  "quickstart",
  "authentication",
  "text-moderation",
  "image-moderation",
  "errors",
] as const;

export type DocSlug = (typeof pages)[number];

const hrefFor: Record<DocSlug, string> = {
  overview: "/docs",
  quickstart: "/docs/quickstart",
  authentication: "/docs/authentication",
  "text-moderation": "/docs/text-moderation",
  "image-moderation": "/docs/image-moderation",
  errors: "/docs/errors",
};

export function DocsView({ slug }: { slug: string }) {
  const t = useTranslations("Docs");
  const site = useTranslations("Site");
  const pathname = usePathname();
  const valid = pages.includes(slug as DocSlug);
  const active = (valid ? slug : "overview") as DocSlug;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-semibold">
              {site("brand")}
            </Link>
            <span className="text-sm text-slate-500">{t("title")}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher tone="light" />
            <Link href="/playground" className="text-sm font-medium text-blue-700">
              {t("openPlayground")}
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[220px_minmax(0,1fr)_220px]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t("contents")}</p>
          <nav className="mt-3 flex flex-col gap-1">
            {pages.map((page) => (
              <Link
                key={page}
                href={hrefFor[page]}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm",
                  pathname === hrefFor[page]
                    ? "bg-blue-50 font-medium text-blue-800"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                {t(`nav.${page}`)}
              </Link>
            ))}
          </nav>
        </aside>
        <article className="min-w-0">
          {valid ? <DocArticle slug={active} /> : <p className="text-sm">{t("missing")}</p>}
        </article>
        <aside className="hidden lg:block">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t("onThisPage")}</p>
          <DocToc slug={active} />
        </aside>
      </div>
    </div>
  );
}

function DocToc({ slug }: { slug: DocSlug }) {
  const t = useTranslations("Docs");
  const sections = t.raw(`pages.${slug}.sections`) as Array<{ id: string; title: string }>;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} className="text-sm text-slate-600 hover:text-slate-950">
          {section.title}
        </a>
      ))}
    </div>
  );
}

function DocArticle({ slug }: { slug: DocSlug }) {
  const t = useTranslations("Docs");
  const format = useFormatters();
  const page = t.raw(`pages.${slug}`) as {
    title: string;
    description: string;
    sections: Array<{ id: string; title: string; paragraphs: string[] }>;
  };

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{page.description}</p>
      <div className="mt-4">
        <PrototypeBanner>{t("contractNotice")}</PrototypeBanner>
      </div>
      <div className="mt-8 space-y-8">
        {page.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="text-xl font-semibold">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm leading-relaxed text-slate-700">
                {paragraph}
              </p>
            ))}
            <SectionExtra slug={slug} sectionId={section.id} />
          </section>
        ))}
      </div>
      {slug === "image-moderation" ? (
        <ul className="mt-6 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>{t("limits.types", { types: moderationLimits.imageExtensions.join(", ") })}</li>
          <li>{t("limits.size", { size: format.bytes(moderationLimits.imageMaxBytes) })}</li>
          <li>{t("limits.timeout", { timeout: format.number(moderationLimits.requestTimeoutMs) })}</li>
          <li>
            {t("limits.rate", {
              count: format.number(moderationLimits.playgroundRequestsPerMinute),
            })}
          </li>
          <li>{t("limits.text", { count: format.number(moderationLimits.textMaxChars) })}</li>
        </ul>
      ) : null}
    </div>
  );
}

function SectionExtra({ slug, sectionId }: { slug: DocSlug; sectionId: string }) {
  const t = useTranslations("Docs");
  if (slug === "quickstart" && sectionId === "request") {
    return (
      <div className="mt-4 space-y-3">
        <CodeBlock code={apiSnippets.textCurl} label="curl" />
        <CodeBlock code={apiSnippets.textNode} label="JavaScript" />
      </div>
    );
  }
  if (slug === "authentication" && sectionId === "header") {
    return (
      <div className="mt-4">
        <CodeBlock code="Authorization: Bearer YOUR_API_KEY" label="HTTP" />
      </div>
    );
  }
  if (slug === "text-moderation" && sectionId === "example") {
    return (
      <div className="mt-4 space-y-3">
        <CodeBlock code={prettyJson(contractExamples.textRequest)} label={t("request")} />
        <CodeBlock code={prettyJson(contractExamples.textResponse)} label={t("response")} />
      </div>
    );
  }
  if (slug === "image-moderation" && sectionId === "example") {
    return (
      <div className="mt-4 space-y-3">
        <CodeBlock code={apiSnippets.imageCurl} label="curl" />
        <CodeBlock code={prettyJson(contractExamples.imageRequest)} label={t("request")} />
        <CodeBlock code={prettyJson(contractExamples.imageResponse)} label={t("response")} />
      </div>
    );
  }
  if (slug === "errors" && sectionId === "catalog") {
    return (
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">{t("code")}</th>
              <th className="px-3 py-2 font-medium">{t("meaning")}</th>
            </tr>
          </thead>
          <tbody>
            {errorCatalog.map((code) => (
              <tr key={code} className="border-t border-slate-200">
                <td className="px-3 py-2 font-mono">{code}</td>
                <td className="px-3 py-2">{t(`errors.${code}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-200 p-3">
          <CodeBlock code={prettyJson(contractExamples.errorResponse)} label={t("response")} />
        </div>
      </div>
    );
  }
  return null;
}
