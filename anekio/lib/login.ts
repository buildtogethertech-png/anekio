import { prisma } from "./prisma";
import { looksLikeEmail, normalizeMobile } from "./phone";

const roleInclude = { role: { include: { grants: true } } } as const;

export async function userForLogin(raw: string) {
  if (looksLikeEmail(raw)) {
    return prisma.user.findUnique({
      where: { email: raw.toLowerCase() },
      include: roleInclude,
    });
  }
  const phone = normalizeMobile(raw);
  if (!phone) return null;
  const byPhone = await prisma.user.findUnique({
    where: { phone },
    include: roleInclude,
  });
  if (byPhone) return byPhone;
  const staff = await prisma.staffMember.findFirst({
    where: { phone, userId: { not: null } },
    include: { user: { include: roleInclude } },
  });
  if (staff?.user) return staff.user;
  const parent = await prisma.parent.findFirst({
    where: { phone },
    include: { user: { include: roleInclude } },
  });
  return parent?.user ?? null;
}
