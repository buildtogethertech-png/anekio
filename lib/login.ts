import { prisma } from "./prisma";
import { looksLikeEmail, normalizeMobile } from "./phone";

const roleInclude = { role: { include: { grants: true } } } as const;
const loginInclude = { ...roleInclude, org: { select: { schoolName: true } } } as const;

export async function usersForLogin(raw: string) {
  if (looksLikeEmail(raw)) {
    return prisma.user.findMany({
      where: { email: raw.toLowerCase() },
      include: loginInclude,
      orderBy: [{ orgId: "asc" }, { createdAt: "asc" }],
    });
  }
  const phone = normalizeMobile(raw);
  if (!phone) return [];
  const byPhone = await prisma.user.findMany({
    where: { phone },
    include: loginInclude,
    orderBy: [{ orgId: "asc" }, { createdAt: "asc" }],
  });
  if (byPhone.length) return byPhone;
  const staff = await prisma.staffMember.findFirst({
    where: { phone, userId: { not: null } },
    include: { user: { include: loginInclude } },
  });
  if (staff?.user) return [staff.user];
  const parent = await prisma.parent.findFirst({
    where: { phone },
    include: { user: { include: loginInclude } },
  });
  return parent?.user ? [parent.user] : [];
}

export async function userForLogin(raw: string) {
  const users = await usersForLogin(raw);
  return users[0] ?? null;
}
