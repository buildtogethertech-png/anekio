import { effectiveAdmissionFormJson } from "./admission-form";
import { prisma } from "./prisma";

export async function configuredAdmissionFormJson(schoolValue: unknown) {
  const platform = await prisma.platformConfig.findUnique({ where: { id: "global" }, select: { admissionFormJson: true } });
  return effectiveAdmissionFormJson(schoolValue, platform?.admissionFormJson);
}
