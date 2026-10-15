import {
  buildFaqLd,
  buildSoftwareApplicationLd,
  JsonLd,
} from "@/components/JsonLd";
import { LandingPage } from "@/components/landing/landing-page";
import { setRequestLocale } from "next-intl/server";

export const instant = false;

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LocaleHomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <JsonLd data={buildSoftwareApplicationLd(locale)} />
      <JsonLd data={buildFaqLd(locale)} />
      <LandingPage locale={locale} />
    </>
  );
}
