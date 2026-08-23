/**
 * Shared portal shell: routed sidebar navigation, live notification feed,
 * and a working account menu (wallet binding, sign out).
 */
import { Bell, ChevronDown, Copy, LogOut, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import PortalSessionActions from "@/components/PortalSessionActions";
import { api } from "@/lib/api";
import { connectWallet } from "@/lib/wallet";
import { useAuth } from "@/contexts/AuthContext";

const logoMark = "/assets/proofsure-logo-mark.png";

export type NavItem = { label: string; path: string; icon: any; badge?: number };

export default function PortalLayout({
  role,
  workspaceTag,
  navItems,
  breadcrumb,
  roleCard,
  children,
}: {
  role: "client" | "hospital" | "provider";
  workspaceTag: string;
  navItems: NavItem[];
  breadcrumb: string;
  roleCard?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { session, signOut, refresh } = useAuth();
  const [location, navigate] = useLocation();
  const [openMenu, setOpenMenu] = useState<"none" | "bell" | "account">("none");
  const [events, setEvents] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const seenKey = `proofsure-seen-${role}`;

  const loadEvents = async () => {
    try {
      const list = await api.events();
      setEvents(list.slice(0, 12));
      const lastSeen = Number(localStorage.getItem(seenKey) ?? 0);
      setUnread(list.filter((e: any) => new Date(e.ts).getTime() > lastSeen).length);
    } catch { /* unauthenticated or offline */ }
  };

  useEffect(() => {
    loadEvents();
    const id = window.setInterval(loadEvents, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpenMenu("none");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const markSeen = () => {
    localStorage.setItem(seenKey, String(Date.now()));
    setUnread(0);
  };

  const bindWallet = async () => {
    try {
      const addr = await connectWallet();
      await api.setWallet(addr);
      await refresh();
      toast.success("Wallet connected", { description: `${addr.slice(0, 8)}…${addr.slice(-6)} bound to your account.` });
    } catch (e) {
      toast.error("Wallet connection failed", { description: (e as Error).message });
    }
  };

  return (
    <div className="client-portal-page">
      <aside className="client-sidebar">
        <div className="client-sidebar-top">
          <a className="client-brand" href="/"><img src={logoMark} alt="" /><span>PROOFSURE</span></a>
          <div className="workspace-tag"><span /> {workspaceTag}</div>
          <nav className="client-nav" aria-label={`${role} portal navigation`}>
            {navItems.map(({ label, path, icon: Icon, badge }) => (
              <button
                key={path}
                className={location === path || location.startsWith(`${path}/`) ? "is-active" : ""}
                onClick={() => navigate(path)}
              >
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                {badge != null && badge > 0 && <em>{badge}</em>}
              </button>
            ))}
          </nav>
        </div>
        {roleCard}
        <PortalSessionActions activeRole={role} />
      </aside>

      <main className="client-main">
        <header className="client-topbar">
          <div className="client-breadcrumb"><span>{role.toUpperCase()}</span><i /> {breadcrumb}</div>
          <div className="client-topbar-actions" ref={popRef}>
            <div className="topbar-pop">
              <button
                className={`icon-control ${unread > 0 ? "has-unread" : ""}`}
                aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
                onClick={() => { setOpenMenu(openMenu === "bell" ? "none" : "bell"); if (openMenu !== "bell") markSeen(); }}
              >
                <Bell size={17} strokeWidth={1.8} />
              </button>
              {openMenu === "bell" && (
                <div className="topbar-menu" role="dialog" aria-label="Activity notifications">
                  <h4>Live activity</h4>
                  <button className="menu-item" onClick={() => { loadEvents(); toast.success("Activity refreshed"); }}>
                    <RefreshCw size={14} /> Refresh now
                  </button>
                  {events.length === 0 && <p className="menu-note">No activity yet. Proof submissions, policy events and settlements appear here.</p>}
                  {events.map((e, i) => (
                    <div className="event-feed-row" key={i}>
                      <em>{String(e.type).replace(/_/g, " ")}</em>
                      <span>{new Date(e.ts).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="topbar-pop">
              <button className="client-account" onClick={() => setOpenMenu(openMenu === "account" ? "none" : "account")} aria-label="Account menu">
                <span className="account-monogram">{(session?.name ?? "?").slice(0, 2).toUpperCase()}</span>
                <span><strong>{session?.name ?? role}</strong><small>{session?.email}</small></span>
                <ChevronDown size={15} />
              </button>
              {openMenu === "account" && (
                <div className="topbar-menu" role="dialog" aria-label="Account controls">
                  <h4>Signed in as {session?.email}</h4>
                  {role === "client" && (
                    session?.wallet ? (
                      <button className="menu-item" onClick={() => { navigator.clipboard.writeText(session.wallet!); toast.success("Wallet address copied"); }}>
                        <Copy size={14} /> {session.wallet.slice(0, 6)}…{session.wallet.slice(-4)} — copy address
                      </button>
                    ) : (
                      <button className="menu-item" onClick={bindWallet}><Wallet size={14} /> Connect wallet</button>
                    )
                  )}
                  <button className="menu-item" onClick={() => navigate("/")}>Public site</button>
                  <button className="menu-item" onClick={() => { signOut(); navigate("/login"); }}><LogOut size={14} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="client-content portal-screen" key={location}>
          {children}
        </div>
      </main>
    </div>
  );
}

export function SectionHead({ kicker, title, sub }: { kicker: string; title: React.ReactNode; sub?: string }) {
  return (
    <div className="section-head">
      <div>
        <p className="portal-eyebrow"><span /> {kicker}</p>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}
