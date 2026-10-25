import { setRequestLocale } from "next-intl/server";
import { TemplatesView } from "@/components/platform/ops-views";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TemplatesView />;
}
