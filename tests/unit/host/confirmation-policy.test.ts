import { describe, expect, it } from "vitest";
import {
  cancelledMessage,
  classifyConfirmationInput,
  confirmationRequiredMessage,
  confirmationReminderMessage,
} from "@/host/confirmation/confirmation-policy";

describe("confirmation policy", () => {
  it.each(["sí", " si ", "CONFIRMO", "Yes"])('classifies "%s" as confirmation', (value) => {
    expect(classifyConfirmationInput(value)).toBe("confirm");
  });

  it.each(["no", " CANCELAR ", "Cancela", "cancel"])('classifies "%s" as cancellation', (value) => {
    expect(classifyConfirmationInput(value)).toBe("cancel");
  });

  it.each(["sí.", "ok", "dale", "confirmo ahora", "", "   ", "✅", 42])('rejects "%s" as ambiguous', (value) => {
    expect(classifyConfirmationInput(value)).toBe("other");
  });

  it("uses deterministic Spanish prompts", () => {
    expect(confirmationRequiredMessage("Eliminar la transacción 12.")).toBe(
      '¿Confirmas esta operación?\nEliminar la transacción 12.\nResponde "sí" para confirmar o "no" para cancelar.',
    );
    expect(confirmationReminderMessage()).toBe(
      'La operación sigue pendiente. Responde "sí" para confirmar o "no" para cancelar.',
    );
    expect(cancelledMessage()).toBe("Operación cancelada.");
  });
});
