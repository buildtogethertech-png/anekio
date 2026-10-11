import { lateStampFromSetup, parseFeeCatalogState, removeInvoiceLateMetadata, replaceInvoiceLateMetadata } from "../lib/fees";
import { prisma } from "../lib/prisma";
import { runWithoutTenant } from "../lib/tenant-context";

async function main() {
  await runWithoutTenant(async () => {
    const [configs, invoices] = await Promise.all([
      prisma.schoolConfig.findMany({ select: { id: true, orgId: true, feeCatalogJson: true } }),
      prisma.feeInvoice.findMany({
        select: { id: true, orgId: true, period: true, metadataJson: true },
      }),
    ]);
    const configByOrg = new Map<string, (typeof configs)[number]>();
    for (const config of configs) {
      const key = config.orgId || "";
      if (!configByOrg.has(key) || config.id === `school:${key}`) configByOrg.set(key, config);
    }
    let monthlyCount = 0;
    for (const invoice of invoices) {
      const monthly = /^\d{4}-(0[1-9]|1[0-2])$/.test(invoice.period);
      const config = configByOrg.get(invoice.orgId || "");
      const policy = lateStampFromSetup(parseFeeCatalogState(config?.feeCatalogJson).late).stamp;
      const metadataJson = monthly
        ? replaceInvoiceLateMetadata(invoice.metadataJson, policy)
        : removeInvoiceLateMetadata(invoice.metadataJson);
      if (monthly) monthlyCount += 1;
      if (metadataJson === invoice.metadataJson) continue;
      await prisma.feeInvoice.update({
        where: { id: invoice.id },
        data: { metadataJson },
      });
    }
    console.log(`Synced current late-fee rules to ${monthlyCount} monthly invoices.`);
  });
}

main().finally(() => prisma.$disconnect());
