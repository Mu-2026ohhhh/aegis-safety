import { setRequestLocale } from "next-intl/server";
import { InquiriesView } from "@/components/platform/inquiries-view";

export const instant = false;

type Props = { params: Promise<{ locale: string }> };

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <InquiriesView />;
}
