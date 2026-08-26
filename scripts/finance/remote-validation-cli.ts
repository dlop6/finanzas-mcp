import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  loadAndRunRemoteFinanceValidation,
  RemoteFinanceValidationError,
} from "./remote-validation";

async function main(): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new RemoteFinanceValidationError("CONFIRMATION_REQUIRED");
  }

  const promptInterface = createInterface({ input, output });
  try {
    await loadAndRunRemoteFinanceValidation({
      prompt: async (message) => {
        output.write(`${message}\n> `);
        return promptInterface.question("");
      },
    });
  } finally {
    promptInterface.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof RemoteFinanceValidationError) {
    const resource = error.resourceId === undefined ? "" : ` Resource: ${error.resourceId}.`;
    const scenario = error.scenario === undefined ? "" : ` Scenario: ${error.scenario}.`;
    process.stderr.write(`Remote Finance validation failed: ${error.code}.${scenario}${resource}\n`);
  } else {
    process.stderr.write("Remote Finance validation failed: TRANSPORT_FAILURE.\n");
  }
  process.exitCode = 1;
});
