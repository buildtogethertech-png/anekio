// Gives old fee payments a receipt (FeeReceipt). Run after the FeeReceipt table exists.
//   npx tsx scripts/backfill-fee-receipts.ts --preview
//   npx tsx scripts/backfill-fee-receipts.ts
import { backfillLegacyReceipts } from "../lib/fee-ledger";
import { prisma } from "../lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--preview");
  const result = await backfillLegacyReceipts({ dryRun });
  const verb = dryRun ? "Would make" : "Made";
  console.log(`${verb} ${result.receipts} receipts for ${result.payments} old payments (₹${result.amount.toLocaleString("en-IN")}).`);
}

main().finally(() => prisma.$disconnect());
