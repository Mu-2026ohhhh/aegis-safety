import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildDatasetLd, JsonLd } from "@/components/JsonLd";
import { LeadModalProvider } from "@/components/lead-modal-context";
import { SiteHeader } from "@/components/site-header";
import { Footer } from "@/components/landing/footer";
import { BenchmarksView } from "@/components/benchmarks-view";

export const instant = false;

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function BenchmarksPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Benchmarks");

  return (
    <LeadModalProvider>
      <JsonLd data={buildDatasetLd()} />
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <SiteHeader />
        <main className="px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-sky-300 uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-4 max-w-3xl text-base text-slate-400">
              {t("description")}
            </p>
            <BenchmarksView />
          </div>
        </main>
        <Footer />
      </div>
    </LeadModalProvider>
  );
}
