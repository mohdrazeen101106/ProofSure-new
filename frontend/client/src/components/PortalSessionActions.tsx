/** Shared portal navigation and session logout controls. */
import { ArrowUpRight, LockKeyhole, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { type Role, rolePortalPaths, useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const roleLabels: Record<Role, string> = { client: "Client", hospital: "Hospital", provider: "Provider" };

export default function PortalSessionActions({ activeRole }: { activeRole: Role }) {
  const { session, signOut } = useAuth();
  const [, setLocation] = useLocation();

  const leave = () => {
    signOut();
    setLocation("/login");
  };

  const navigateRole = (role: Role) => {
    if (role !== session?.role) {
      toast.error(`${roleLabels[role]} workspace restricted`, { description: `This session is signed in as ${roleLabels[session?.role ?? activeRole].toLowerCase()}. Access is enforced by server-side role authorization.` });
      return;
    }
    setLocation(rolePortalPaths[role]);
  };

  return (
    <div className="portal-session-actions">
      <div className="portal-role-switcher" aria-label="Workspace access">
        <span>WORKSPACE ACCESS</span>
        {(Object.keys(roleLabels) as Role[]).map((role) => (
          <button className={role === activeRole ? "is-current" : "is-restricted"} key={role} onClick={() => navigateRole(role)}>
            {role === activeRole ? <i /> : <LockKeyhole size={11} />} {roleLabels[role]}
          </button>
        ))}
      </div>
      <a href="/">Public site <ArrowUpRight size={14} /></a>
      <button onClick={leave}>Log out <LogOut size={14} /></button>
    </div>
  );
}
