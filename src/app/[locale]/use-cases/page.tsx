import { setRequestLocale } from "next-intl/server";
import { UseCasesView } from "@/components/platform/simple-pages";

export const instant = false;

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <UseCasesView />
  );
}
