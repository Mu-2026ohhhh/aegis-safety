"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { LoadingBlock } from "@/components/platform/ui";
import { OperatorGate } from "@/lib/platform/session";

const WorkflowEditor = dynamic(
  () => import("@/components/platform/workflow-editor").then((mod) => mod.WorkflowEditor),
  {
    ssr: false,
    loading: () => <WorkflowLoading />,
  }
);

function WorkflowLoading() {
  const t = useTranslations("Workflows");
  return <LoadingBlock label={t("loading")} />;
}

export function WorkflowScreen() {
  return (
    <OperatorGate>
      <WorkflowEditor />
    </OperatorGate>
  );
}
