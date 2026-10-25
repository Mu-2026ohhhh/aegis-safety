import { setRequestLocale } from "next-intl/server";
import { KnowledgeView } from "@/components/platform/catalog-views";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <KnowledgeView />;
}
