/** UI-only route gate — production enforcement must move to protected server routes. */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { type Role, useAuth } from "@/contexts/AuthContext";

export default function RoleGate({ role, children }: { role: Role; children: React.ReactNode }) {
  const { ready, session } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      setLocation("/login");
      return;
    }
    if (session.role !== role) setLocation(`/access-denied?attempt=${role}`);
  }, [ready, role, session?.role, setLocation]);

  if (!ready || session?.role !== role) {
    return <div className="role-gate-loading"><span>ROUTE CHECK / {role.toUpperCase()}</span><i /></div>;
  }

  return <>{children}</>;
}
