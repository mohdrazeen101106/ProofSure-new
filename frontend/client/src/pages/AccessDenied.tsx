/**
 * Role-aware access-denied state for the frontend-only ProofSure prototype.
 * Production access decisions must be performed by protected server routes.
 */
import { ArrowUpRight, LockKeyhole, MoveLeft, ShieldX } from "lucide-react";
import { useLocation } from "wouter";
import { type Role, rolePortalPaths, useAuth } from "@/contexts/AuthContext";

const logoMark = "/assets/proofsure-logo-mark.png";
const roleLabel: Record<Role, string> = { client: "Client", hospital: "Hospital", provider: "Provider" };
const roleBrief: Record<Role, string> = {
  client: "your private cover, proof route, and personal claims",
  hospital: "registered-hospital invoice and claim-bundle workflows",
  provider: "policy, reserve, registry, and settlement operations",
};

function readAttempt(path: string): Role | null {
  const value = new URLSearchParams(path.split("?")[1] ?? "").get("attempt");
  return value === "client" || value === "hospital" || value === "provider" ? value : null;
}

export default function AccessDenied() {
  const [location, setLocation] = useLocation();
  const { session } = useAuth();
  const attempted = readAttempt(location);
  const currentRole = session?.role;

  const returnToAllowed = () => {
    if (currentRole) setLocation(rolePortalPaths[currentRole]);
    else setLocation("/login");
  };

  return (
    <main className="access-denied-page">
      <div className="denied-grid" aria-hidden="true" />
      <a href="/" className="denied-brand"><img src={logoMark} alt="" /><span><b>PROOF</b><i>SURE</i></span><em>///</em></a>
      <div className="denied-route denied-route-top"><span>YOUR AUTHORITY</span><i /><span>REQUESTED WORKSPACE</span></div>
      <div className="denied-terrain-art" aria-hidden="true"><i /><i /><i /><b><img src={logoMark} alt="" /></b><span>ROUTE<br />INTERRUPTED</span></div>
      <section className="denied-panel">
        <div className="denied-status"><span><ShieldX size={18} /></span><p>ROUTE RESTRICTED / {attempted ? attempted.toUpperCase() : "UNKNOWN"}</p></div>
        <h1>{currentRole ? <><em>{roleLabel[currentRole]}</em> authority cannot open this route.</> : <>This route needs a <em>verified authority.</em></>}</h1>
        <p className="denied-copy">{currentRole && attempted ? <>Your current session is restricted to {roleBrief[currentRole]}. The {roleLabel[attempted]} workspace is available only to a separately authorized role and organization.</> : <>Sign in with an authorized account before entering a restricted workspace. Access decisions are enforced server-side by role and organization checks.</>}</p>
        <div className="denied-access-map">
          <div className="denied-map-head"><span>ACCESS MAP</span><b>{currentRole ? `${roleLabel[currentRole].toUpperCase()} ACTIVE` : "NO ACTIVE SESSION"}</b></div>
          {(["client", "hospital", "provider"] as Role[]).map((role, index) => <div className={role === currentRole ? "is-permitted" : role === attempted ? "is-denied" : ""} key={role}><span>{String(index + 1).padStart(2, "0")}</span><strong>{roleLabel[role]}</strong><i /> <em>{role === currentRole ? "PERMITTED" : role === attempted ? "RESTRICTED" : "OTHER AUTHORITY"}</em></div>)}
        </div>
        <div className="denied-actions"><button className="denied-primary" onClick={returnToAllowed}>{currentRole ? `Return to ${roleLabel[currentRole]} workspace` : "Sign in to continue"} <ArrowUpRight size={17} /></button><button className="denied-secondary" onClick={() => setLocation("/login")}><MoveLeft size={16} /> Change account</button></div>
        <p className="denied-note"><LockKeyhole size={14} /> Access decisions are enforced by server-side role middleware; this page is presented when a session attempts to enter a workspace outside its authorization.</p>
      </section>
      <div className="denied-knot" aria-hidden="true"><img src={logoMark} alt="" /><span>CHECK<br />THE ROUTE</span></div>
    </main>
  );
}
