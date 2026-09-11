import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type NavItem, type SessionUser } from "./api";
import { act } from "./mutate";
import { clearToken, getToken, setToken } from "./storage";

type Session = {
  ready: boolean;
  token: string | null;
  user: SessionUser | null;
  nav: NavItem[];
  refresh: () => Promise<void>;
  signIn: (login: string, password: string) => Promise<void>;
  requestLoginCode: (login: string) => Promise<AuthCodeResponse>;
  signInWithCode: (login: string, code: string) => Promise<void>;
  requestPasswordReset: (login: string) => Promise<AuthCodeResponse>;
  resetPassword: (login: string, code: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export type AuthCodeResponse = {
  ok: true;
  message: string;
  destination: string;
  expiresInSeconds: number;
  developmentCode?: string;
};

type LoginResponse = { token: string; user: SessionUser; nav: NavItem[] };

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setTok] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [nav, setNav] = useState<NavItem[]>([]);

  async function hydrate(next: string) {
    const me = await api<{ user: SessionUser; nav: NavItem[] }>("/me", next);
    setTok(next);
    setUser(me.user);
    setNav(me.nav);
  }

  async function applyLogin(response: LoginResponse) {
    await setToken(response.token);
    setTok(response.token);
    setUser(response.user);
    setNav(response.nav);
  }

  useEffect(() => {
    (async () => {
      const saved = await getToken();
      if (saved) {
        try {
          await hydrate(saved);
        } catch {
          await clearToken();
        }
      }
      setReady(true);
    })();
  }, []);

  const value = useMemo<Session>(
    () => ({
      ready,
      token,
      user,
      nav,
      async refresh() {
        const saved = token || (await getToken());
        if (!saved) return;
        await hydrate(saved);
      },
      async signIn(login, password) {
        const res = await api<LoginResponse>("/login", null, {
          method: "POST",
          body: JSON.stringify({ login, password }),
        });
        await applyLogin(res);
      },
      async requestLoginCode(login) {
        return api<AuthCodeResponse>("/login/otp/request", null, {
          method: "POST",
          body: JSON.stringify({ login }),
        });
      },
      async signInWithCode(login, code) {
        const res = await api<LoginResponse>("/login/otp/verify", null, {
          method: "POST",
          body: JSON.stringify({ login, code }),
        });
        await applyLogin(res);
      },
      async requestPasswordReset(login) {
        return api<AuthCodeResponse>("/login/password/request", null, {
          method: "POST",
          body: JSON.stringify({ login }),
        });
      },
      async resetPassword(login, code, password) {
        await api<{ ok: true }>("/login/password/reset", null, {
          method: "POST",
          body: JSON.stringify({ login, code, password }),
        });
      },
      async signOut() {
        try {
          if (token) await act(token, "savePushToken", { token: "" });
        } catch {
          /* still leave */
        }
        await clearToken();
        setTok(null);
        setUser(null);
        setNav([]);
      },
    }),
    [ready, token, user, nav]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession");
  return ctx;
}
