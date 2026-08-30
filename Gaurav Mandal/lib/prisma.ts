import { PrismaClient } from "@prisma/client";
import { prepareVercelRuntime } from "./vercel-runtime";

prepareVercelRuntime();

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaStamp?: string;
};

const stamp = "push-1";

if (globalForPrisma.prisma && globalForPrisma.prismaStamp !== stamp) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaStamp = stamp;
}
