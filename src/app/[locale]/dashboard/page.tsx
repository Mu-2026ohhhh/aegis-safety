import { setRequestLocale } from "next-intl/server";
import { DashboardConsole } from "@/components/dashboard/dashboard-console";

export const instant = false;

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <DashboardConsole />;
}
