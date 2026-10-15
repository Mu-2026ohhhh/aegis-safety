"use client";

import { Playground } from "@/components/Playground";
import { PricingCalculator } from "@/components/PricingCalculator";
import { LeadModalProvider } from "@/components/lead-modal-context";
import { SiteHeader } from "@/components/site-header";
import { CtaBanner } from "@/components/landing/cta-banner";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { SocialProof } from "@/components/landing/social-proof";

export function LandingPage({ locale }: { locale: string }) {
  return (
    <LeadModalProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.12),transparent_55%)]" />
        <SiteHeader />
        <main>
          <Hero />
          <SocialProof />
          <Features />
          <Playground />
          <PricingCalculator locale={locale} />
          <CtaBanner />
        </main>
        <Footer />
      </div>
    </LeadModalProvider>
  );
}
