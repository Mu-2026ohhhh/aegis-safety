import { setRequestLocale } from "next-intl/server";
import { DocsView } from "@/components/platform/docs-view";

export const instant = false;

type Props = { params: Promise<{ locale: string; slug?: string[] }> };

export default async function Page({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = slug?.[0] ?? "overview";
  return <DocsView slug={slug && slug.length > 1 ? "missing" : page} />;
}
