/**
 * Real authentication against the ProofSure backend (JWT, role-based).
 * JWT-backed session management against the orchestration backend.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setToken, getToken, type User } from "@/lib/api";

export type Role = "client" | "hospital" | "provider";

type Session = {
  email: string;
  role: Role;
  name: string;
  wallet: string | null;
  hospitalId?: string | null;
};

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<Session>;
  register: (b: { email: string; password: string; name: string; role: Role }) => Promise<Session>;
  signOut: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toSession(u: User): Session {
  return { email: u.email, role: u.role, name: u.name, wallet: u.wallet ?? null, hospitalId: u.hospitalId ?? null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const { user } = await api.me();
          setSession(toSession(user));
        } catch {
          setToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    ready,
    login: async (email, password) => {
      const { token, user } = await api.login(email, password);
      setToken(token);
      const s = toSession(user);
      setSession(s);
      return s;
    },
    register: async (b) => {
      const { token, user } = await api.register(b);
      setToken(token);
      const s = toSession(user);
      setSession(s);
      return s;
    },
    signOut: () => {
      setToken(null);
      setSession(null);
    },
    refresh: async () => {
      if (!getToken()) return;
      try {
        const { user } = await api.me();
        setSession(toSession(user));
      } catch {
        /* keep current */
      }
    },
  }), [ready, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const rolePortalPaths: Record<Role, string> = {
  client: "/client",
  hospital: "/hospital",
  provider: "/provider",
};
