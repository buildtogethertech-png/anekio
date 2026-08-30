export const portals = ["OFFICE", "TEACHER", "PARENT", "STUDENT"] as const;

export type Portal = (typeof portals)[number];

export type TestAccount = {
  login: string;
  password: string;
};

const seededAccounts: Record<Portal, TestAccount> = {
  OFFICE: { login: "office.fixture@school.test", password: "fixture-pass-123" },
  TEACHER: { login: "teacher.fixture@school.test", password: "fixture-pass-123" },
  PARENT: { login: "parent.fixture@school.test", password: "fixture-pass-123" },
  STUDENT: { login: "student.fixture@school.test", password: "fixture-pass-123" },
};

export function accountFor(portal: Portal): TestAccount {
  return {
    login: process.env[`ANEKIO_${portal}_LOGIN`] || seededAccounts[portal].login,
    password: process.env[`ANEKIO_${portal}_PASSWORD`] || seededAccounts[portal].password,
  };
}
