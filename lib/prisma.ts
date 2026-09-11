import { Prisma, PrismaClient } from "@prisma/client";
import { prepareVercelRuntime } from "./vercel-runtime";
import { currentTenantOrg } from "./tenant-context";

prepareVercelRuntime();

const tenantModels = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "orgId"))
    .map((model) => model.name)
);

function schoolConfigKey(orgId: string) {
  return `school:${orgId}`;
}

function rewriteSchoolConfigIds(value: unknown, orgId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteSchoolConfigIds(item, orgId));
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(row).map(([key, child]) => [
      key,
      key === "id" && child === "school" ? schoolConfigKey(orgId) : rewriteSchoolConfigIds(child, orgId),
    ])
  );
}

function withTenantWhere(args: Record<string, unknown>, model: string, operation: string, orgId: string) {
  const where = args.where;
  const scopedWhere = model === "SchoolConfig" ? rewriteSchoolConfigIds(where, orgId) : where;
  // `findUnique`/`update`/`delete` accept extra non-unique filters only when
  // they remain alongside the unique selector.  AND would remove that
  // selector and make Prisma reject the query before it reaches the database.
  if (["findUnique", "findUniqueOrThrow", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(operation)) {
    args.where = { ...(scopedWhere as Record<string, unknown> | undefined), orgId };
  } else {
    args.where = scopedWhere ? { AND: [scopedWhere, { orgId }] } : { orgId };
  }
}

const prismaExtension = Prisma.defineExtension({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const orgId = currentTenantOrg();
        if (!orgId || !model || !tenantModels.has(model)) return query(args);

        const inputWhere = (args as Record<string, unknown>).where;
        const legacySchoolConfig =
          model === "SchoolConfig" &&
          inputWhere &&
          typeof inputWhere === "object" &&
          (inputWhere as Record<string, unknown>).id === "school";

        // Scope every read and mutation.  For creates, stamp the tenant too;
        // explicit orgId values are overwritten so callers cannot cross-write.
        if (operation === "create" || operation === "createMany") {
          const data = args.data;
          if (Array.isArray(data)) {
            args.data = data.map((row) => {
              const next: Record<string, unknown> = { ...(row as Record<string, unknown>), orgId };
              if (model === "SchoolConfig" && next.id === "school") next.id = schoolConfigKey(orgId);
              return next;
            });
          } else if (data && typeof data === "object") {
            const next: Record<string, unknown> = { ...(data as Record<string, unknown>), orgId };
            if (model === "SchoolConfig" && next.id === "school") next.id = schoolConfigKey(orgId);
            args.data = next;
          }
        } else if (operation === "upsert") {
          const create = args.create;
          if (create && typeof create === "object") {
            const nextCreate: Record<string, unknown> = { ...(create as Record<string, unknown>), orgId };
            if (model === "SchoolConfig" && nextCreate.id === "school") nextCreate.id = schoolConfigKey(orgId);
            args.create = nextCreate;
          }
          const update = args.update;
          if (update && typeof update === "object") args.update = { ...(update as Record<string, unknown>), orgId };
          withTenantWhere(args as Record<string, unknown>, model, operation, orgId);
        } else {
          withTenantWhere(args as Record<string, unknown>, model, operation, orgId);
        }

        if (!legacySchoolConfig || operation === "upsert") return query(args);

        // New organisations use a tenant-specific config key.  Keep the old
        // `id: school` row readable during local transitions, but never cross
        // the org boundary because both attempts include orgId.
        const scoped = args as Record<string, unknown>;
        const scopedWhere = scoped.where as Record<string, unknown> | undefined;
        const keyWhere = { ...(scopedWhere || {}), id: schoolConfigKey(orgId) };
        scoped.where = keyWhere;
        try {
          const result = await query(args);
          if (!(Array.isArray(result) && result.length === 0) && result !== null) return result;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2025")) throw error;
        }
        scoped.where = { ...(scopedWhere || {}), id: "school" };
        return query(args);
      },
    },
  },
});

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaStamp?: string;
};

const stamp = "tenant-scope-1";

if (globalForPrisma.prisma && globalForPrisma.prismaStamp !== stamp) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

const basePrisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Keep the generated Prisma surface for callers while the runtime client is
// transparently tenant-scoped by the extension above.
export const prisma = basePrisma.$extends(prismaExtension) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaStamp = stamp;
}
