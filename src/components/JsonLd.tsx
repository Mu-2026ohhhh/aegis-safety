type JsonLdProps = {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
};

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function buildSoftwareApplicationLd(locale: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Aegis Safety OS",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Enterprise content safety and LLM evaluation platform for global markets.",
    inLanguage: locale,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: "0",
      description: "Pay-as-you-go moderation API with enterprise plans",
    },
    featureList: [
      "Multimodal content moderation",
      "LLM safety evaluations",
      "Policy automation",
      "EU AI Act readiness",
    ],
  };
}

export function buildDatasetLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Aegis Public LLM Safety Leaderboard",
    description:
      "Open rankings of foundation models on jailbreak resistance, sensitive-topic refusal, and privacy protection.",
    creator: {
      "@type": "Organization",
      name: "Aegis Safety OS",
    },
    license: "https://creativecommons.org/licenses/by/4.0/",
    temporalCoverage: "2026",
  };
}

export function buildFaqLd(locale: string) {
  const faqs =
    locale === "zh"
      ? [
          {
            q: "Aegis Safety OS 支持哪些内容类型？",
            a: "支持文本、图像、语音与视频的多模态实时审核，以及大模型输出护栏。",
          },
          {
            q: "是否符合 GDPR 与 EU AI Act？",
            a: "支持欧盟数据驻留、零数据保留选项，并提供面向 EU AI Act 的审计证据与策略控制。",
          },
          {
            q: "如何开始试用？",
            a: "可直接使用交互沙盒免费测试 3 次，或预约企业演示获取完整控制台权限。",
          },
        ]
      : locale === "es"
        ? [
            {
              q: "¿Qué tipos de contenido admite Aegis Safety OS?",
              a: "Moderación multimodal en tiempo real de texto, imagen, audio y video, además de guardrails para salidas de LLM.",
            },
            {
              q: "¿Es compatible con GDPR y la EU AI Act?",
              a: "Ofrece residencia de datos en la UE, opción de retención cero y controles listos para auditoría de la EU AI Act.",
            },
            {
              q: "¿Cómo puedo probar la plataforma?",
              a: "Use el sandbox interactivo con 3 pruebas gratis o reserve una demo empresarial.",
            },
          ]
        : [
            {
              q: "What content types does Aegis Safety OS support?",
              a: "Real-time multimodal moderation for text, image, audio, and video, plus LLM output guardrails.",
            },
            {
              q: "Are you GDPR and EU AI Act ready?",
              a: "Yes — EU data residency, zero data retention options, and audit-ready policy controls for the EU AI Act.",
            },
            {
              q: "How can I try the platform?",
              a: "Use the interactive sandbox for 3 free tests, or book an enterprise demo for full console access.",
            },
          ];

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}
