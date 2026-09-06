-- CreateEnum
CREATE TYPE "SalePricingMode" AS ENUM ('CATALOG', 'CUSTOM_UNIT', 'CUSTOM_LINE');

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "businessId" INTEGER NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "inventoryMovementId" INTEGER NOT NULL,
    "pricingMode" "SalePricingMode" NOT NULL,
    "catalogUnitPrice" DECIMAL(14,2) NOT NULL,
    "appliedUnitPrice" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sale_transactionId_key" ON "Sale"("transactionId");
CREATE INDEX "Sale_businessId_idx" ON "Sale"("businessId");
CREATE UNIQUE INDEX "SaleLine_inventoryMovementId_key" ON "SaleLine"("inventoryMovementId");
CREATE INDEX "SaleLine_saleId_idx" ON "SaleLine"("saleId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
