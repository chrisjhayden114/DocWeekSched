import { AI_GENERATED_CHIP_LABEL } from "@event-app/shared";

/** Shared chip for AI drafts — agents draft, humans publish. */
export function AiGeneratedChip({ className }: { className?: string }) {
  return (
    <span className={`chip ai-generated-chip${className ? ` ${className}` : ""}`} role="status">
      {AI_GENERATED_CHIP_LABEL}
    </span>
  );
}
