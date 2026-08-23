/**
 * Measured Terrain visual system: neo-editorial cartography, limestone fields, graphite ink, Proof Lime signals.
 */
import { animate, stagger } from "animejs";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Menu,
  MoveDownRight,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Reveal from "@/components/Reveal";

const heroImage = "/assets/proofsure-hero-terrain.jpg";
const sourceMapImage = "/assets/proofsure-source-map.jpg";
const ribbonImage = "/assets/proofsure-ribbon-detail.jpg";
const logoMark = "/assets/proofsure-logo-mark.png";

const navItems = [
  ["How it works", "#method"],
  ["Privacy", "#platform"],
  ["Payouts", "#outcomes"],
];

const workflow = [
  {
    number: "01",
    title: "Gather the record",
    copy: "Bring sources, decisions, and context into one evidence field without forcing teams into another rigid ritual.",
    detail: "Sources stay attributable",
  },
  {
    number: "02",
    title: "Make connections visible",
    copy: "Link the claim to the source, the source to its context, and the context to the people who need a clear answer.",
    detail: "Relationships stay inspectable",
  },
  {
    number: "03",
    title: "Move with proof",
    copy: "Publish a defensible route forward, with a record that survives review, handover, and the questions that come later.",
    detail: "Confidence is earned in view",
  },
];

function scrollToId(id: string) {
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Home() {
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const sourceVisualRef = useRef<HTMLDivElement>(null);
  const ribbonFrameRef = useRef<HTMLDivElement>(null);
  const statementTextRef = useRef<HTMLParagraphElement>(null);
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<number | null>(null);
  const [activeLedger, setActiveLedger] = useState<number | null>(null);
  const [typedStatementTail, setTypedStatementTail] = useState("");

  const statementPrefix = "Getting a premium quote should not mean handing over sensitive health details to an insurer. ";
  const statementTail = "A hospital bill should not be easy to forge, and an honest claim should not wait weeks for manual approval.";

  useEffect(() => {
    if (reduceMotion || !headlineRef.current) return;
    const words = headlineRef.current.querySelectorAll(".hero-word");
    animate(words, {
      opacity: [0, 1],
      translateY: ["0.78em", "0em"],
      duration: 920,
      delay: stagger(80, { start: 110 }),
      ease: "out(4)",
    });
  }, [reduceMotion]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 26);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".transition-section"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const section = entry.target as HTMLElement;
          section.classList.remove("is-transitioning");
          requestAnimationFrame(() => section.classList.add("is-transitioning"));
        });
      },
      { threshold: 0.28, rootMargin: "-8% 0px -14%" },
    );

    sections.forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      sections.forEach((section) => section.classList.remove("is-transitioning"));
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      setTypedStatementTail(statementTail);
      return;
    }
    const target = statementTextRef.current;
    if (!target) return;
    let timeout = 0;
    let active = true;
    let started = false;
    const play = () => {
      let index = 0;
      let phase: "typing" | "holding" | "deleting" | "final" = "typing";
      const tick = () => {
        if (!active) return;
        setTypedStatementTail(statementTail.slice(0, index));
        if (phase === "typing") {
          if (index < statementTail.length) { index += 1; timeout = window.setTimeout(tick, 14); }
          else { phase = "holding"; timeout = window.setTimeout(tick, 1150); }
          return;
        }
        if (phase === "holding") { phase = "deleting"; timeout = window.setTimeout(tick, 28); return; }
        if (phase === "deleting") {
          if (index > 0) { index -= 1; timeout = window.setTimeout(tick, 9); }
          else { phase = "final"; timeout = window.setTimeout(tick, 210); }
          return;
        }
        if (index < statementTail.length) { index += 1; timeout = window.setTimeout(tick, 12); }
      };
      tick();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started) { started = true; play(); }
    }, { threshold: 0.45 });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); window.clearTimeout(timeout); };
  }, [reduceMotion, statementTail]);

  const handleHeroPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (reduceMotion || !artRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 14;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 12;
    artRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const handleSurfacePointer = (event: React.PointerEvent<HTMLDivElement>, surface: HTMLDivElement | null, depth = 4) => {
    if (reduceMotion || !surface) return;
    const rect = surface.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    surface.style.setProperty("--surface-x", `${x * depth}px`);
    surface.style.setProperty("--surface-y", `${y * depth}px`);
    surface.style.setProperty("--surface-rotate-x", `${y * -1.8}deg`);
    surface.style.setProperty("--surface-rotate-y", `${x * 1.8}deg`);
  };

  const resetSurface = (surface: HTMLDivElement | null) => {
    surface?.style.removeProperty("--surface-x");
    surface?.style.removeProperty("--surface-y");
    surface?.style.removeProperty("--surface-rotate-x");
    surface?.style.removeProperty("--surface-rotate-y");
  };

  return (
    <main className="proofsure-page">
      <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
        <a className="brand-lockup" href="#top" aria-label="ProofSure home" onClick={() => scrollToId("#top")}>
          <img src={logoMark} alt="" />
          <span>PROOFSURE</span>
        </a>

        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map(([label, href]) => (
            <a key={label} href={href} onClick={() => scrollToId(href)}>
              {label}
            </a>
          ))}
        </nav>

        <a className="header-action desktop-only" href="/login">
          Log in <ArrowUpRight size={16} strokeWidth={2.2} />
        </a>

        <button
          className="mobile-menu-trigger"
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {menuOpen && (
        <motion.nav
          className="mobile-nav"
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -18 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          aria-label="Mobile navigation"
        >
          {navItems.map(([label, href]) => (
            <a key={label} href={href} onClick={() => { setMenuOpen(false); scrollToId(href); }}>
              {label} <ArrowUpRight size={18} />
            </a>
          ))}
          <button className="header-action" onClick={() => { setMenuOpen(false); scrollToId("#contact"); }}>
            Log in <ArrowUpRight size={16} />
          </button>
        </motion.nav>
      )}

      <section id="top" className="hero-section" onPointerMove={handleHeroPointer} onPointerLeave={() => artRef.current?.style.removeProperty("transform")}>
        <div className="hero-surface" />
        <div className="hero-coordinate coordinate-one">N 25° 12′ / E 55° 16′</div>
        <div className="hero-coordinate coordinate-two">PRIVATE COVER / 001</div>
        <div className="hero-brand-stamp">
          <img src={logoMark} alt="" />
          <span><strong>PROOFSURE</strong><small>PRIVATE HEALTH COVER / 01</small></span>
        </div>

        <div className="hero-copy hero-copy-lowered">
          <p className="eyebrow"><span className="eyebrow-dot" /> Private underwriting. Provable claims. Automatic payouts.</p>
          <h1 ref={headlineRef}>
            <span className="hero-word">Insurance you can</span><br />
            <span className="hero-word secondary-emphasis" style={{textDecoration: 'none'}}>prove, not just</span><br style={{textDecoration: 'none'}} />
            <span className="hero-word">trust.</span>
          </h1>
          <p className="hero-deck">
            Get insured and get paid—without ever handing over your medical history.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => scrollToId("#contact")}>
              Explore the proof route <ArrowUpRight size={18} strokeWidth={2.3} />
            </button>
            <button className="text-button" onClick={() => scrollToId("#method")}>
              See how it works <MoveDownRight size={18} />
            </button>
          </div>
        </div>

        <div ref={artRef} className="hero-art" aria-hidden="true">
          <img className="hero-art-image" src={heroImage} alt="" />
          <div className="proof-pin pin-one"><span>01</span><b>LOCAL DATA</b><i /></div>
          <div className="proof-pin pin-two"><span>02</span><b>ZK PROOF</b><i /></div>
          <div className="proof-pin pin-three"><span>03</span><b>PAYOUT</b><i /></div>
          <div className="model-message">PRIVATE DATA <strong>→</strong> PROOF <strong>→</strong> AUTOMATIC PAYOUT</div>
          <div className="art-caption">LOCAL INFERENCE / VERIFIED CLAIM / PAID ON-CHAIN</div>
        </div>

        <button className="scroll-signal" onClick={() => scrollToId("#method")} aria-label="Scroll to how it works">
          <span>Scroll to follow the proof</span><ChevronDown size={17} />
        </button>
      </section>

      <section id="method" className="statement-section section-shell transition-section">
        <div className="coordinate-rail"><span>01</span><i /><span>HOW IT WORKS</span></div>
        <Reveal delay={0.08} className="statement-main transition-text-flow statement-main-centered">
          <p className="eyebrow statement-central-label">The problem with health insurance today</p>
          <h2>Insurance can’t demand your <em>medical history.</em></h2>
          <p ref={statementTextRef} className="statement-typed-copy">
            <span>{statementPrefix}</span><span className="statement-typed-tail">{typedStatementTail}</span>{!reduceMotion && <i className="typing-caret" aria-hidden="true" />}
          </p>
        </Reveal>
        <Reveal delay={0.16} className="statement-aside transition-text-flow">
          <span className="aside-number">01</span>
          <p>Private health features stay on your device during premium calculation.</p>
        </Reveal>
      </section>

      <section id="platform" className="workflow-section transition-section" data-active-step={activeWorkflow ?? "none"}>
        <div className="workflow-topline section-shell transition-text-flow">
          <p className="eyebrow"><span className="eyebrow-dot" /> One policy. Two private proof flows.</p>
          <p className="workflow-note">The insurer sees the proof and public policy values—not your raw health data or medical bill.</p>
        </div>

        <div className="workflow-grid section-shell transition-content-flow">
          {workflow.map((item, index) => (
            <Reveal
              key={item.number}
              delay={index * 0.06}
              className={`workflow-item ${activeWorkflow === index ? "is-active" : ""}`}
              onPointerEnter={() => setActiveWorkflow(index)}
              onPointerLeave={() => setActiveWorkflow(null)}
            >
              <span className="workflow-number">{item.number}</span>
              <div className="workflow-body">
                <h3>{["Price your policy privately", "Activate cover on Ethereum", "Prove a claim. Get paid."][index]}</h3>
                <p>{[
                  "A small model runs in your browser, calculates a premium locally, and creates a ZKML proof. Your health inputs stay with you.",
                  "The insurer creates a policy after verifying the premium proof. You pay from your wallet and the contract records coverage, balance, and expiry.",
                  "A hospital-signed invoice becomes a claim proof. The contract checks coverage and replay protection, then pays a valid claim automatically.",
                ][index]}</p>
                <span className="workflow-detail"><Check size={15} strokeWidth={2.5} /> {[
                  "Local model + ZKML proof",
                  "Policy state is on-chain",
                  "Proof verified, payout sent",
                ][index]}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="workflow-connector" aria-hidden="true">
          <svg viewBox="0 0 1200 130" preserveAspectRatio="none"><path d="M0 92 C160 10 288 128 452 66 S745 7 902 64 S1080 112 1200 30" /></svg>
          <span className="connector-dot first" /><span className="connector-dot second" /><span className="connector-dot third" />
        </div>
        <div className="workflow-route-label section-shell" aria-hidden="true">
          <span>FLOW / 02</span><i /><b>LOCAL MODEL</b><i /><b>POLICY</b><i /><b>AUTOMATIC PAYOUT</b>
        </div>
      </section>

      <section className="source-section section-shell transition-section">
        <div className="source-text transition-text-flow">
          <Reveal><p className="eyebrow">The privacy boundary is explicit</p></Reveal>
          <Reveal delay={0.08}><h2>Your medical history is not the <em>application.</em></h2></Reveal>
          <Reveal delay={0.16}>
            <p className="source-copy">Private health inputs and hospital bills remain with the client or hospital. The insurer and blockchain only receive proofs, public policy values, claim state, and payouts.</p>
            <a className="inline-link" href="#contact" onClick={() => scrollToId("#contact")}>Trace the privacy boundary <ArrowUpRight size={17} /></a>
          </Reveal>
        </div>

        <Reveal delay={0.1} className="source-visual-reveal transition-visual-flow">
          <div
            ref={sourceVisualRef}
            className="source-visual-wrap responsive-surface"
            onPointerMove={(event) => handleSurfacePointer(event, sourceVisualRef.current, 12)}
            onPointerLeave={() => resetSurface(sourceVisualRef.current)}
          >
            <div className="visual-field-label">CLIENT / PRIVATE DATA</div>
            <img src={sourceMapImage} alt="Abstract map of linked sources converging around a confirmed evidence point." className="source-visual" />
            <span className="source-stamp">PROOF<br />ONLY</span>
          </div>
        </Reveal>
      </section>

      <section id="outcomes" className="outcomes-section transition-section" data-active-ledger={activeLedger ?? "none"}>
        <div className="outcomes-route-label section-shell" aria-hidden="true"><span>FLOW / 04</span><i /> PROOF HELPS POLICY MOVE</div>
        <div className="outcomes-heading section-shell transition-text-flow">
          <Reveal><p className="eyebrow"><span className="eyebrow-dot" /> What ProofSure proves in practice</p></Reveal>
          <Reveal delay={0.08}><h2>Trust without exposure. Payouts without <em>permission.</em></h2></Reveal>
        </div>

        <div className="outcomes-ledger section-shell transition-content-flow">
          <Reveal className={`ledger-row ${activeLedger === 0 ? "is-active" : ""}`} onPointerEnter={() => setActiveLedger(0)} onPointerLeave={() => setActiveLedger(null)}>
            <span>01 / Customer privacy</span>
            <h3>Your health profile stays on your device.</h3>
            <p>Underwriting uses a local model and a proof of the result—never a raw health profile sent to provider servers.</p>
          </Reveal>
          <Reveal delay={0.08} className={`ledger-row ${activeLedger === 1 ? "is-active" : ""}`} onPointerEnter={() => setActiveLedger(1)} onPointerLeave={() => setActiveLedger(null)}>
            <span>02 / Claim integrity</span>
            <h3>A signed hospital invoice becomes a verifiable fact.</h3>
            <p>Fake hospitals, repeat claims, uncovered treatment, and excess payouts fail before money can move.</p>
          </Reveal>
          <Reveal delay={0.16} className={`ledger-row ${activeLedger === 2 ? "is-active" : ""}`} onPointerEnter={() => setActiveLedger(2)} onPointerLeave={() => setActiveLedger(null)}>
            <span>03 / Automatic settlement</span>
            <h3>A valid claim does not wait for approval.</h3>
            <p>Once proof, policy state, coverage, and nullifier checks pass, the contract sends the payout automatically.</p>
          </Reveal>
        </div>
      </section>

      <section className="ribbon-section section-shell transition-section">
        <Reveal className="ribbon-reveal transition-visual-flow">
          <div
            ref={ribbonFrameRef}
            className="ribbon-frame responsive-surface"
            onPointerMove={(event) => handleSurfacePointer(event, ribbonFrameRef.current, 9)}
            onPointerLeave={() => resetSurface(ribbonFrameRef.current)}
          >
            <span className="ribbon-index">CLAIM FLOW / 05</span>
            <img src={ribbonImage} alt="Abstract ribbons converging into a verified confirmation mark." />
            <p>Hospital bill stays private. Claim proof is public.</p>
            <span className="ribbon-confirmation">VERIFIED PAYOUT <i /></span>
          </div>
        </Reveal>
      </section>

      <section id="contact" className="closing-section transition-section">
        <div className="closing-grid section-shell transition-text-flow">
          <Reveal><p className="eyebrow"><span className="eyebrow-dot" /> For customers, hospitals, and providers</p></Reveal>
          <Reveal delay={0.08}><h2>Private by design. <em>Provable by default.</em></h2></Reveal>
          <Reveal delay={0.16} className="closing-action">
            <p>Get insured and get paid without handing over your medical history or waiting for an approval queue.</p>
            <a className="primary-button" href="mailto:hello@proofsure.com">Start the proof route <ArrowUpRight size={18} strokeWidth={2.3} /></a>
          </Reveal>
        </div>
        <div className="closing-coordinate">PROOFSURE / PRIVATE HEALTH COVER / 2026</div>
        <div className="closing-brand-moment" aria-hidden="true"><img src={logoMark} alt="" /><span>PROOFSURE<br /><i>PRIVATE HEALTH COVER</i></span></div>
      </section>

      <footer className="site-footer section-shell">
        <a className="brand-lockup" href="#top" onClick={() => scrollToId("#top")}>
          <img src={logoMark} alt="" />
          <span>PROOFSURE</span>
        </a>
        <p>Insurance you can prove.</p>
        <div className="footer-links"><a href="#method">How it works</a><a href="#platform">Privacy</a><a href="mailto:hello@proofsure.com">Contact</a></div>
      </footer>
    </main>
  );
}
