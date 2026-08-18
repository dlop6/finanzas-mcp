import { Prisma } from "@/database/generated/prisma/client";

export class FinanceRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FinanceRepositoryError";
  }
}

export class EntityNotFoundError extends FinanceRepositoryError {
  constructor(entity: string, id: number) {
    super(`${entity} with id ${id} was not found.`);
    this.name = "EntityNotFoundError";
  }
}

export class ActiveBusinessNotFoundError extends FinanceRepositoryError {
  constructor() {
    super("No active business is configured.");
    this.name = "ActiveBusinessNotFoundError";
  }
}

export class ActiveBusinessAmbiguousError extends FinanceRepositoryError {
  constructor() {
    super("More than one active business is configured.");
    this.name = "ActiveBusinessAmbiguousError";
  }
}

export class PersistenceConflictError extends FinanceRepositoryError {
  constructor(entity: string) {
    super(`${entity} conflicts with an existing record.`);
    this.name = "PersistenceConflictError";
  }
}

export class InventoryIntegrityError extends FinanceRepositoryError {
  constructor() {
    super("The inventory operation would result in negative stock.");
    this.name = "InventoryIntegrityError";
  }
}

export function normalizePersistenceError(error: unknown, entity: string, id?: number): FinanceRepositoryError {
  if (error instanceof FinanceRepositoryError) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025" && id !== undefined) {
      return new EntityNotFoundError(entity, id);
    }

    if (error.code === "P2002") {
      return new PersistenceConflictError(entity);
    }
  }

  return new FinanceRepositoryError("The financial data could not be accessed.", { cause: error });
}
