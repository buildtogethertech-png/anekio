import { effectiveFormJson } from "./admission-form";
import { prisma } from "./prisma";

export type FormKind = "admission" | "website" | "staff";

const PLATFORM_COLUMN = {
  admission: "admissionFormJson",
  website: "websiteFormJson",
  staff: "staffOnboardingFormJson",
} as const;

/** The form in effect for a school: its own saved form, else the Anekio default in PlatformConfig. */
export async function configuredFormJson(kind: FormKind, schoolValue: unknown) {
  const platform = await prisma.platformConfig.findUnique({ where: { id: "global" } });
  return effectiveFormJson(schoolValue, platform?.[PLATFORM_COLUMN[kind]]);
}

export async function configuredAdmissionFormJson(schoolValue: unknown) {
  return configuredFormJson("admission", schoolValue);
}
