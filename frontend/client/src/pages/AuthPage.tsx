/**
 * ProofSure login/sign-up — real JWT authentication against the orchestration backend.
 */
import { ArrowUpRight, BadgeCheck, ChevronRight, CircleDot, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { type Role, rolePortalPaths, useAuth } from "@/contexts/AuthContext";

const logoMark = "/assets/proofsure-logo-mark.png";
const ribbonImage = "/assets/proofsure-ribbon-detail.jpg";
const roleOptions: Array<{ role: Role; number: string; title: string; copy: string }> = [
  { role: "client", number: "01", title: "Client", copy: "View your own cover, private proof route, and claims." },
  { role: "hospital", number: "02", title: "Hospital", copy: "Prepare registered-hospital invoice proofs and signed bundles." },
  { role: "provider", number: "03", title: "Provider", copy: "Manage public policy state, reserve, and proof-based settlement." },
];

export default function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [role, setRole] = useState<Role>("client");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const isSignup = mode === "signup";

  const proceed = async (fn: () => Promise<{ role: Role }>) => {
    setBusy(true);
    try {
      const s = await fn();
      setLocation(rolePortalPaths[s.role]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`auth-page auth-page--${mode}`}>
      <aside className="auth-aside">
        <a href="/" className="auth-brand"><img src={logoMark} alt="" /><span><b>PROOF</b><i>SURE</i></span></a>
        <span className="auth-aside-coordinate">N 25° 12′ / E 55° 16′</span>
        <div className="auth-aside-copy">
          <p className="portal-eyebrow"><span /> PRIVATE COVER / PUBLIC PROOF</p>
          <h1>Enter the proof route <em>by verified authority.</em></h1>
          <p>Each workspace is designed around a separate role, organization, and set of permitted actions.</p>
        </div>
        <div className="auth-aside-visual" aria-hidden="true"><img src={ribbonImage} alt="" /></div>
        <div className="auth-route-diagram" aria-hidden="true"><span>CLIENT</span><i /><span>HOSPITAL</span><i /><span>PROVIDER</span><b><img src={logoMark} alt="" /></b></div>
        <div className={`auth-mode-stamp auth-mode-stamp--${mode}`}><span>{isSignup ? "ROUTE INITIATION" : "ROUTE RESUMPTION"}</span><i /> <b>{isSignup ? "MARK" : "RE-ENTER"}</b></div>
        <div className="auth-proof-prism" aria-hidden="true"><i /><i /><i /><b><img src={logoMark} alt="" /></b></div>
        <p className="auth-footnote">SECURED BY BACKEND AUTHORIZATION / ROLE CHECKED SERVER-SIDE</p>
      </aside>

      <main className="auth-main">
        <div className="auth-topline"><span>{isSignup ? "CREATE ACCESS" : "AUTHENTICATED SESSION"}</span><a href={isSignup ? "/login" : "/signup"}>{isSignup ? "Continue an existing route" : "Open a different route"} <ChevronRight size={14} /></a></div>
        <div className="auth-card auth-card-route">
          <div className="auth-heading"><span>{isSignup ? "01 / MARK A ROUTE" : "01 / VERIFY A ROUTE"}</span><h2>{isSignup ? <>Mark your <em>authorized route.</em></> : <>Enter your <em>credentials.</em></>}</h2><p>{isSignup ? "Register an account with the backend authorization service. Your role determines every action you can take." : "Log in with your ProofSure account. Sessions are issued by the backend as signed tokens."}</p></div>

          {isSignup && (
            <div className="auth-role-list" role="radiogroup" aria-label="Workspace role">
              {roleOptions.map((option) => <button className={role === option.role ? "is-selected" : ""} key={option.role} onClick={() => setRole(option.role)} role="radio" aria-checked={role === option.role}><span className="auth-role-number">{option.number}</span><span><strong>{option.title}</strong><small>{option.copy}</small></span><span className="auth-role-state">{role === option.role ? <><BadgeCheck size={18} /><b>ACTIVE</b></> : <><CircleDot size={15} /><b>AVAILABLE</b></>}</span></button>)}
            </div>
          )}

          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (isSignup) {
                proceed(() => register({ email, password, name, role }));
              } else {
                proceed(() => login(email, password));
              }
            }}
          >
            {isSignup && (
              <label className="auth-field"><span>Full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" />
              </label>
            )}
            <label className="auth-field"><span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
            </label>
            <label className="auth-field"><span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" />
            </label>
            <button className="auth-primary" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" size={17} /> : <ArrowUpRight size={17} />}
              {isSignup ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="auth-prototype-note"><ShieldCheck size={15} /> Authentication is enforced server-side. Provider actions require the provider role; hospital signing requires the hospital role.</p>
        </div>
      </main>
    </div>
  );
}
