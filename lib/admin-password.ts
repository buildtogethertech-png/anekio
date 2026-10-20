import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

/**
 * Admin sets a new password for any login in the school (staff, teacher or parent).
 * Only roles with "Roles and access" (admins). The person gets a bell notice so a reset never happens silently.
 * Target: { userId } directly, or { parentId } from a student's parent card.
 */
export async function adminSetPasswordCore(user: AccessUser, input: { userId?: string; parentId?: string; password?: string }) {
  if (!can(user, "roles.manage")) throw new Error("Only an admin can change someone else's password.");
  if (user.support) throw new Error("Not available during a support login.");
  const password = String(input.password || "").trim();
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  let userId = String(input.userId || "");
  if (!userId && input.parentId) {
    const parent = await prisma.parent.findUnique({ where: { id: String(input.parentId) }, select: { userId: true } });
    userId = parent?.userId || "";
  }
  if (!userId) throw new Error("This person has no login yet.");
  if (userId === user.id) throw new Error("To change your own password, use Profile → Change password.");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  if (!target) throw new Error("Login not found.");

  await prisma.user.update({ where: { id: target.id }, data: { password: await bcrypt.hash(password, 10) } });

  await prisma.notice
    .create({
      data: {
        eventKey: `PASSWORD_RESET:${target.id}:${Date.now()}`,
        title: "Your password was changed",
        body: `${user.name || "The school admin"} set a new password for your Anekio login. If you did not ask for this, contact the school office.`,
        kind: "ACCOUNT",
        priority: "ACTION",
        authorId: user.id,
        recipients: { create: [{ userId: target.id }] },
      },
    })
    .catch(() => undefined);

  return { name: target.name };
}
