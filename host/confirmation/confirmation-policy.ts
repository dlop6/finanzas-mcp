export type ConfirmationDecision = "confirm" | "cancel" | "other";

const confirmations = new Set(["sí", "si", "confirmo", "yes"]);
const cancellations = new Set(["no", "cancelar", "cancela", "cancel"]);

export function classifyConfirmationInput(value: unknown): ConfirmationDecision {
  if (typeof value !== "string") return "other";
  const normalized = value.normalize("NFC").trim().toLocaleLowerCase("es");
  if (confirmations.has(normalized)) return "confirm";
  if (cancellations.has(normalized)) return "cancel";
  return "other";
}

export function confirmationRequiredMessage(description: string): string {
  return `¿Confirmas esta operación?\n${description}\nResponde "sí" para confirmar o "no" para cancelar.`;
}

export function confirmationReminderMessage(): string {
  return 'La operación sigue pendiente. Responde "sí" para confirmar o "no" para cancelar.';
}

export function cancelledMessage(): string {
  return "Operación cancelada.";
}
