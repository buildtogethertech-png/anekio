/**
 * Local helper: writes prisma/seed-data/platform-forms.json into the PlatformConfig "global" row.
 * Production uses prisma/seed-data/platform-forms.sql instead.
 *   npx tsx scripts/apply-platform-forms.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";

async function main() {
  const file = path.resolve(process.cwd(), "prisma/seed-data/platform-forms.json");
  const forms = JSON.parse(readFileSync(file, "utf8")) as Record<"admissionFormJson" | "websiteFormJson" | "staffOnboardingFormJson", unknown[]>;
  const data = {
    admissionFormJson: JSON.stringify(forms.admissionFormJson),
    websiteFormJson: JSON.stringify(forms.websiteFormJson),
    staffOnboardingFormJson: JSON.stringify(forms.staffOnboardingFormJson),
  };
  await prisma.platformConfig.upsert({ where: { id: "global" }, update: data, create: { id: "global", ...data } });
  console.log("PlatformConfig default forms updated.");
}

main().finally(() => prisma.$disconnect());
