import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { runWithoutTenant } from "./tenant-context";

type OrgRepairDelegate = {
  updateMany(args: { where: { orgId: null }; data: { orgId: string } }): Promise<unknown>;
};

const nullableOrgModels = Prisma.dmmf.datamodel.models
  .filter((model) => model.fields.some((field) => field.name === "orgId" && !field.isRequired))
  .map((model) => model.name);

function delegateName(model: string) {
  return `${model.slice(0, 1).toLowerCase()}${model.slice(1)}`;
}

export async function repairSingleOrgLegacyData() {
  return runWithoutTenant(async () => {
    const orgs = await prisma.saasOrg.findMany({ select: { id: true }, take: 2 });
    if (orgs.length !== 1) return null;
    const orgId = orgs[0].id;

    for (const model of nullableOrgModels) {
      const delegate = (prisma as unknown as Record<string, OrgRepairDelegate | undefined>)[delegateName(model)];
      if (!delegate?.updateMany) continue;
      await delegate.updateMany({ where: { orgId: null }, data: { orgId } });
    }

    return orgId;
  });
}
