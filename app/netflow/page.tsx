"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OwnerEvidence } from "@/lib/netflow/evidence";
import { makeT, useLang, type T } from "@/lib/netflow/i18n";
import { riskFromEvidence, type Driver } from "@/lib/netflow/risk";
import { searchTerms, type Candidate, type Constraints } from "@/lib/netflow/search";
import { DEFAULT_SCENARIO, simulate, type Scenario } from "@/lib/netflow/sim";
import { Bars3D, type Pillar } from "./bars3d";

type Role = "A" | "D" | "C" | "E";
type Ev = OwnerEvidence | { error: string };

const OWNERS = [
  { id: "P01", en: "P01 Margaret Okafor · prime", ko: "P01 Margaret Okafor · 우량" },
  { id: "P19", en: "P19 Grace Nakamura · cafe owner", ko: "P19 Grace Nakamura · 카페 운영자" },
  { id: "P08", en: "P08 Priya Venkatesan · lien + judgment", ko: "P08 Priya Venkatesan · lien·판결" },
  { id: "P17", en: "P17 Elena Castellanos · bureaus disagree", ko: "P17 Elena Castellanos · 기관 간 불일치" },
  { id: "P15", en: "P15 Nicole Farragut · TU frozen", ko: "P15 Nicole Farragut · TU 동결" },
  { id: "P07", en: "P07 Marcus Bellamy · Chapter 13 active", ko: "P07 Marcus Bellamy · 챕터13 진행 중" },
];

const EMPTY_CURVE = Array.from({ length: 121 }, (_, day) => ({ day, p05: 0, p50: 0, p95: 0 }));
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function riskColor(pLate: number) {
  if (pLate < 0.15) return "#24CB71";
  if (pLate < 0.3) return "#FFC700";
  return "#FF3737";
}

function driverText(t: T, d: Driver) {
  const a = money(d.amount ?? 0);
  switch (d.key) {
    case "score": return t("dScore", { n: d.n ?? 0 });
    case "noScore": return t("dNoScore");
    case "partialNoScore": return t("dPartial", { n: d.n ?? 0 });
    case "collections": return t("dCollections", { n: d.n ?? 0 });
    case "derog": return t("dDerog", { n: d.n ?? 0 });
    case "bkActive": return t("dBkActive");
    case "bkDischarged": return t("dBkDischarged");
    case "judgments": return t("dJudgments", { n: d.n ?? 0, a });
    case "liens": return t("dLiens", { n: d.n ?? 0, a });
  }
}

export default function NetflowPage() {
  const [lang, setLang] = useLang();
  const t = makeT(lang);

  const [owners, setOwners] = useState<Record<Role, string>>({ A: "P08", D: "P17", C: "P01", E: "P07" });
  const [evidence, setEvidence] = useState<Record<string, Ev>>({});
  const [sc, setSc] = useState<Scenario>(DEFAULT_SCENARIO);
  const [selected, setSelected] = useState<Role>("A");
  const [day, setDay] = useState(120);
  const [playing, setPlaying] = useState(false);

  // Scroll story: while the sticky scene is pinned, page scroll drives the day.
  const storyRef = useRef<HTMLDivElement>(null);
  const inStory = useRef(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = storyRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.top > 8) {
          if (inStory.current) {
            inStory.current = false;
            setDay(DEFAULT_SCENARIO.horizonDays);
          }
          return;
        }
        inStory.current = true;
        const total = Math.max(1, r.height - window.innerHeight);
        const p = Math.min(1, Math.max(0, (8 - r.top) / total));
        setPlaying(false);
        setDay(Math.round(p * DEFAULT_SCENARIO.horizonDays));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const requested = useRef(new Set<string>());
  useEffect(() => {
    for (const id of new Set(Object.values(owners))) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      fetch("/api/netflow/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: id }),
      })
        .then((r) => r.json())
        .then((d) => setEvidence((e) => ({ ...e, [id]: d })))
        .catch((err) => setEvidence((e) => ({ ...e, [id]: { error: String(err) } })));
    }
  }, [owners]);

  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => {
      setDay((d) => {
        if (d >= sc.horizonDays) {
          setPlaying(false);
          return d;
        }
        return d + 1;
      });
    }, 90);
    return () => clearInterval(h);
  }, [playing, sc.horizonDays]);

  const ready = (Object.values(owners) as string[]).every((id) => evidence[id] && !("error" in evidence[id]));
  const risks = useMemo(() => {
    if (!ready) return null;
    const r = (role: Role) => riskFromEvidence(evidence[owners[role]] as OwnerEvidence);
    return { A: r("A"), D: r("D"), C: r("C"), E: r("E") };
  }, [ready, evidence, owners]);
  const result = useMemo(() => (risks ? simulate(sc, risks) : null), [risks, sc]);

  const [cons, setCons] = useState<Constraints>({ minExpectedProfit: 15000, maxShortfallProb: 0.1, maxExtraFunds: 20000 });
  const [found, setFound] = useState<{ feasible: Candidate[]; closest: Candidate[] } | null>(null);
  const runSearch = () => risks && setFound(searchTerms(sc, risks, cons));

  const setA = (patch: Partial<Scenario["customerA"]>) => setSc((s) => ({ ...s, customerA: { ...s.customerA, ...patch } }));

  const events = useMemo(() => {
    const A = sc.customerA;
    const list: { day: number; key: string; edge: Role; amount: number }[] = [];
    if (A.prepayPct > 0) list.push({ day: 0, key: "prepayEvt", edge: "A", amount: A.orderAmount * A.prepayPct * (1 - A.prepayDiscountPct) });
    list.push({ day: 10 + A.dueDays, key: "evtA", edge: "A", amount: A.orderAmount * (1 - A.prepayPct) });
    list.push({ day: 40, key: "evtD", edge: "D", amount: sc.customerDOrder });
    const parts = sc.supplierC.installments;
    for (let i = 0; i < parts; i++) list.push({ day: sc.supplierC.dueDays + i * 15, key: "evtC", edge: "C", amount: sc.supplierC.amount / parts });
    list.push({ day: sc.supplierE.dueDays, key: "evtE", edge: "E", amount: sc.supplierE.amount });
    return list.sort((a, b) => a.day - b.day);
  }, [sc]);

  const passed = [...events].filter((e) => e.day <= day).pop();
  const caption = passed
    ? `${t("day")} ${passed.day} · ${t(passed.key)} ${money(passed.amount)} — ${t("ex_" + passed.key)}`
    : t("ex_start", { cash: money(sc.b.cash) });
  const roleName = (r: Role) => t(r === "A" ? "custA" : r === "D" ? "custD" : r === "C" ? "suppC" : "suppE");
  const isActive = (r: Role) => events.some((e) => e.edge === r && day >= e.day && day <= e.day + 4);

  const pillars: Pillar[] = [
    { id: "A", title: roleName("A"), amount: sc.customerA.orderAmount, inflow: true, active: isActive("A") },
    { id: "D", title: roleName("D"), amount: sc.customerDOrder, inflow: true, active: isActive("D") },
    { id: "C", title: roleName("C"), amount: sc.supplierC.amount, inflow: false, active: isActive("C") },
    { id: "E", title: roleName("E"), amount: sc.supplierE.amount, inflow: false, active: isActive("E") },
  ].map((x) => {
    const r = x.id as Role;
    const ev = evidence[owners[r]];
    const scores = ev && !("error" in ev) ? ev.bureaus.map((b) => b.score).filter((n): n is number => n !== null) : [];
    return {
      ...x,
      late: risks ? risks[r].pLate : 0,
      riskColor: risks ? riskColor(risks[r].pLate) : "#94a3b8",
      sub: `${owners[r]}${scores.length ? ` · ${Math.min(...scores)}` : ""}${risks ? ` · ${pct(risks[r].pLate)} ${t("lateWord")}` : ""}`,
    };
  });

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const tone = (v: number, hi: number, mid: number) => (v > hi ? "#FFE3E3" : v > mid ? "#FFF1CC" : "#DDF7E8");

  return (
    <div className="min-h-screen bg-white text-[#0d0d0d]">
      <main className="mx-auto max-w-[1200px] px-5 pb-24 text-[15px] md:px-8">
        {/* top bar */}
        <nav className="sticky top-0 z-30 -mx-5 flex items-center justify-between bg-white/85 px-5 py-4 backdrop-blur md:-mx-8 md:px-8">
          <div className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid grid-cols-2 gap-[3px]">
              {["#0D99FF", "#24CB71", "#FF7237", "#874FFF"].map((c) => (
                <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              ))}
            </span>
            Netflow
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-[#f2f2f2] p-1 text-sm" role="group" aria-label="Language">
              {(["en", "ko"] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)} className={`rounded-full px-3.5 py-1.5 font-medium transition ${lang === l ? "bg-black text-white" : "text-neutral-600 hover:text-black"}`}>
                  {l === "en" ? "EN" : "한국어"}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* hero */}
        <header className="pb-14 pt-12 md:pb-20 md:pt-20">
          <div className="mb-6 flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#DDF7E8] px-3.5 py-1.5 font-medium text-[#0b6b38]"><i className="h-2 w-2 rounded-full bg-[#24CB71]" />{t("badgeLive")}</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#FFF1CC] px-3.5 py-1.5 font-medium text-[#7a5a00]"><i className="h-2 w-2 rounded-full bg-[#FFC700]" />{t("badgeSim")}</span>
          </div>
          <h1 className="max-w-4xl text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] md:text-[84px]">{t("heroTitle")}</h1>
          <p className="mt-6 max-w-2xl text-xl leading-snug text-neutral-500 md:text-2xl">{t("heroSub")}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button onClick={() => go("story")} className="rounded-full bg-black px-6 py-3 font-medium text-white transition hover:bg-neutral-800">{t("ctaStart")}</button>
            <button onClick={() => go("evidence")} className="rounded-full border border-black/15 px-6 py-3 font-medium transition hover:bg-black/5">{t("ctaEvidence")}</button>
          </div>
          <p className="mt-8 max-w-3xl rounded-2xl bg-[#f5f5f5] p-4 text-sm leading-relaxed text-neutral-600">{t("disclaimer")}</p>
        </header>

        {/* story */}
        <section id="story" className="scroll-mt-20">
          <SectionHead title={t("sec1T")} sub={t("sec1S")} />
          <div ref={storyRef} className="h-[340vh]">
            <div className="sticky top-[72px]">
              <div className="rounded-[32px] bg-[#EEF3F8] p-2.5 md:p-3">
                <Bars3D curve={result?.cashCurve ?? EMPTY_CURVE} day={day} pillars={pillars} bTitle={t("nodeB")} bSub={t("cashNow")} selected={selected} onSelect={(id) => setSelected(id as Role)} dayWord={t("day")} hint={t("dragHint")} caption={caption} progress={day / sc.horizonDays} scrollHint={t("scrollHint")} />
                <div className="flex flex-wrap items-center gap-3 px-2 pb-1 pt-3 md:px-3">
                  <button onClick={() => { if (day >= sc.horizonDays) setDay(0); setPlaying((p) => !p); }} className="rounded-full bg-black px-5 py-2 font-medium text-white hover:bg-neutral-800">
                    {playing ? `❚❚ ${t("pause")}` : `▶ ${t("play")}`}
                  </button>
                  <button onClick={() => { setPlaying(false); setDay(0); }} className="rounded-full border border-black/15 bg-white px-4 py-2 font-medium hover:bg-black/5">{t("reset")}</button>
                  <input aria-label={t("day")} type="range" min={0} max={sc.horizonDays} value={day} onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }} className="min-w-[160px] flex-1 accent-black" />
                  <div className="w-24 text-right font-mono text-sm tabular-nums">{t("day")} {day}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-1 text-xs md:px-3">
                  {events.map((e, i) => (
                    <span key={i} className={`rounded-full px-3 py-1.5 font-medium ${day >= e.day ? (e.edge === "C" || e.edge === "E" ? "bg-[#FFE4D6] text-[#a8400f]" : "bg-[#DDF7E8] text-[#0b6b38]") : "bg-white text-neutral-400"}`}>
                      {t("day")} {e.day} · {t(e.key)} {money(e.amount)}
                    </span>
                  ))}
                </div>
                <p className="px-3 pb-2 text-xs text-neutral-500">{t("legendBars")} {t("legendPillars")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* controls */}
        <section className="pt-16 md:pt-24">
          <SectionHead title={t("sec2T")} sub={t("sec2S")} />
          <div className="grid gap-4 md:grid-cols-3">
            <Panel>
              <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("selected")}: {t(selected === "A" ? "custA" : selected === "D" ? "custD" : selected === "C" ? "suppC" : "suppE")}</h3>
              <label className="block text-xs font-medium text-neutral-500">{t("ownerPersona")}</label>
              <select className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white p-3 font-medium" value={owners[selected]} onChange={(e) => setOwners((o) => ({ ...o, [selected]: e.target.value }))}>
                {OWNERS.map((o) => <option key={o.id} value={o.id}>{o[lang]}</option>)}
              </select>
              {!evidence[owners[selected]] && <p className="mt-3 text-neutral-500">{t("waiting")}</p>}
              {risks && (
                <div className="mt-4 space-y-2 text-sm text-neutral-600">
                  <p className="font-medium text-black">{t("assumed", { late: pct(risks[selected].pLate), def: pct(risks[selected].pDefault) })}</p>
                  <p>{t("because")}: {risks[selected].drivers.map((d) => driverText(t, d)).join("; ") || t("noAdverse")}</p>
                </div>
              )}
            </Panel>
            <Panel>
              <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("termsTitle")}</h3>
              <div className="space-y-4">
                <Slider label={t("sOrder")} value={sc.customerA.orderAmount} min={20000} max={120000} step={5000} fmt={money} onChange={(v) => setA({ orderAmount: v })} />
                <Slider label={t("sPrepay")} value={sc.customerA.prepayPct} min={0} max={0.6} step={0.05} fmt={pct} onChange={(v) => setA({ prepayPct: v })} />
                <Slider label={t("sDiscount")} value={sc.customerA.prepayDiscountPct} min={0} max={0.15} step={0.01} fmt={pct} onChange={(v) => setA({ prepayDiscountPct: v })} />
                <Slider label={t("sDue")} value={sc.customerA.dueDays} min={15} max={90} step={15} fmt={(v) => `${v}`} onChange={(v) => setA({ dueDays: v })} />
              </div>
            </Panel>
            <Panel>
              <h3 className="mb-3 text-lg font-semibold tracking-tight">{t("scenarioTitle")}</h3>
              <div className="space-y-4">
                <Slider label={t("sCash")} value={sc.b.cash} min={0} max={50000} step={1000} fmt={money} onChange={(v) => setSc((x) => ({ ...x, b: { ...x.b, cash: v } }))} />
                <Slider label={t("sLine")} value={sc.b.creditLine} min={0} max={50000} step={1000} fmt={money} onChange={(v) => setSc((x) => ({ ...x, b: { ...x.b, creditLine: v } }))} />
                <Slider label={t("sInstall")} value={sc.supplierC.installments} min={1} max={2} step={1} fmt={(v) => (v === 2 ? t("yes") : t("no"))} onChange={(v) => setSc((x) => ({ ...x, supplierC: { ...x.supplierC, installments: v === 2 ? 2 : 1 } }))} />
                <Slider label={t("sStress")} value={sc.stress} min={1} max={2.5} step={0.25} fmt={(v) => `×${v}`} onChange={(v) => setSc((x) => ({ ...x, stress: v }))} />
              </div>
            </Panel>
          </div>
        </section>

        {/* results */}
        <section className="pt-16 md:pt-24">
          <SectionHead title={t("sec3T")} sub={t("sec3S")} />
          {result ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Metric label={t("mProfit")} value={money(result.expectedProfit)} hint={t("mProfitHint", { v: money(result.profitP05) })} bg="#E5F4FF" />
                <Metric label={t("mGap")} value={pct(result.pGap)} hint={t("mGapHint")} bg={tone(result.pGap, 0.3, 0.1)} />
                <Metric label={t("mLine")} value={pct(result.pShortfall)} hint={t("mLineHint")} bg={tone(result.pShortfall, 0.3, 0.1)} />
                <Metric label={t("mFunds")} value={money(result.extraFundsP95)} hint={t("mFundsHint")} bg="#F0EAFF" />
                <Metric label={t("mCascade")} value={money(result.cascadeExpected)} hint={t("mCascadeHint", { v: pct(result.pCascade) })} bg={tone(result.pCascade, 0.3, 0.1)} />
              </div>
              <Panel>
                <div className="mb-2 text-lg font-semibold tracking-tight">{t("chartTitle")}</div>
                <CashChart curve={result.cashCurve} day={day} />
                <p className="mt-1 text-xs text-neutral-500">{t("chartNote", { n: result.trials.toLocaleString() })}</p>
              </Panel>
            </div>
          ) : (
            <p className="text-neutral-500">{t("waiting")}</p>
          )}
        </section>

        {/* search */}
        <section className="pt-16 md:pt-24">
          <div className="rounded-[32px] bg-black p-6 text-white md:p-12">
            <h2 className="max-w-2xl text-3xl font-semibold leading-[1.05] tracking-[-0.035em] md:text-5xl">{t("sec4T")}</h2>
            <p className="mt-3 max-w-2xl text-lg text-neutral-400">{t("sec4S")}</p>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <Slider dark label={t("cMinProfit")} value={cons.minExpectedProfit} min={0} max={40000} step={1000} fmt={money} onChange={(v) => setCons((c) => ({ ...c, minExpectedProfit: v }))} />
              <Slider dark label={t("cMaxLine")} value={cons.maxShortfallProb} min={0} max={0.5} step={0.01} fmt={pct} onChange={(v) => setCons((c) => ({ ...c, maxShortfallProb: v }))} />
              <Slider dark label={t("cMaxFunds")} value={cons.maxExtraFunds} min={0} max={60000} step={1000} fmt={money} onChange={(v) => setCons((c) => ({ ...c, maxExtraFunds: v }))} />
            </div>
            <button disabled={!risks} onClick={runSearch} className="mt-8 rounded-full bg-white px-6 py-3 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-40">{t("searchBtn")}</button>
            {found && (
              <div className="mt-8 space-y-3">
                {found.feasible.length ? (
                  found.feasible.map((c, i) => <CandidateRow key={i} c={c} t={t} onApply={() => { setSc(c.scenario); go("story"); }} />)
                ) : (
                  <>
                    <p className="text-[#FFC700]">{t("noFeasible")}</p>
                    {found.closest.map((c, i) => <CandidateRow key={i} c={c} t={t} onApply={() => { setSc(c.scenario); go("story"); }} />)}
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* evidence */}
        <section id="evidence" className="scroll-mt-20 pt-16 md:pt-24">
          <SectionHead title={t("sec5T")} sub={t("sec5S")} />
          <div className="grid gap-4 md:grid-cols-2">
            {(["A", "D", "C", "E"] as Role[]).map((role) => (
              <EvidenceCard key={role} t={t} title={`${t(role === "A" ? "custA" : role === "D" ? "custD" : role === "C" ? "suppC" : "suppE")} → ${owners[role]}`} ev={evidence[owners[role]]} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <h2 className="text-4xl font-semibold leading-[1.03] tracking-[-0.04em] md:text-6xl">{title}</h2>
      <p className="mt-4 text-lg text-neutral-500 md:text-xl">{sub}</p>
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[28px] bg-[#f5f5f5] p-6 ${className}`}>{children}</div>;
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void; dark?: boolean }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-sm">
        <span className={p.dark ? "text-neutral-400" : "text-neutral-600"}>{p.label}</span>
        <b className="tabular-nums">{p.fmt(p.value)}</b>
      </div>
      <input className={`w-full ${p.dark ? "accent-white" : "accent-black"}`} type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

function Metric({ label, value, hint, bg }: { label: string; value: string; hint: string; bg: string }) {
  return (
    <div className="rounded-[24px] p-5" style={{ background: bg }}>
      <div className="text-sm font-medium text-black/60">{label}</div>
      <div className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums md:text-[38px]">{value}</div>
      <div className="mt-3 text-xs leading-snug text-black/55">{hint}</div>
    </div>
  );
}

function CashChart({ curve: c, day }: { curve: { day: number; p05: number; p50: number; p95: number }[]; day: number }) {
  const W = 900;
  const H = 220;
  const min = Math.min(0, ...c.map((p) => p.p05));
  const max = Math.max(1, ...c.map((p) => p.p95));
  const x = (d: number) => (d / (c.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const line = (k: "p05" | "p50" | "p95") => c.map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p[k])}`).join(" ");
  const band = `${line("p95")} ${[...c].reverse().map((p) => `L${x(p.day)},${y(p.p05)}`).join(" ")} Z`;
  const cur = c[Math.min(day, c.length - 1)];
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full">
      <path d={band} fill="rgb(135 79 255 / 0.14)" />
      <path d={line("p50")} fill="none" stroke="#0D99FF" strokeWidth="3" strokeLinejoin="round" />
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="#FF3737" strokeDasharray="5 5" />
      <text x="4" y={y(0) - 5} fontSize="11" fill="#FF3737">$0</text>
      <line x1={x(day)} x2={x(day)} y1="0" y2={H} stroke="#0d0d0d" strokeOpacity="0.35" />
      <circle cx={x(day)} cy={y(cur.p50)} r="6" fill="#0D99FF" stroke="#fff" strokeWidth="2" />
      <text x={W - 4} y={H + 18} textAnchor="end" fontSize="11" fill="#8a8a8a">{c.length - 1}</text>
      <text x="4" y={H + 18} fontSize="11" fill="#8a8a8a">0</text>
    </svg>
  );
}

function CandidateRow({ c, t, onApply }: { c: Candidate; t: T; onApply: () => void }) {
  const A = c.scenario.customerA;
  const label = t("candLabel", {
    o: money(A.orderAmount),
    p: Math.round(A.prepayPct * 100),
    d: A.prepayPct ? ` (−${Math.round(A.prepayDiscountPct * 100)}%)` : "",
    n: A.dueDays,
    i: c.scenario.supplierC.installments,
  });
  const vText = (v: Candidate["violations"][number]) =>
    v.constraint === "minExpectedProfit" ? t("vProfit", { v: money(v.by) }) : v.constraint === "maxShortfallProb" ? t("vLine", { v: Math.round(v.by * 100) }) : t("vFunds", { v: money(v.by) });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/10 p-4">
      <div>
        <div className="font-medium">{label}</div>
        <div className="mt-1 text-sm text-neutral-400">
          {t("candProfit")} {money(c.result.expectedProfit)} · {t("candLine")} {pct(c.result.pShortfall)} · {t("candFunds")} {money(c.result.extraFundsP95)}
          {c.violations.length > 0 && <span className="text-[#FF8A8A]"> · {c.violations.map(vText).join("; ")}</span>}
        </div>
      </div>
      <button onClick={onApply} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200">{t("apply")}</button>
    </div>
  );
}

function EvidenceCard({ title, ev, t }: { title: string; ev?: Ev; t: T }) {
  if (!ev) return <Panel className="text-neutral-500">{title}: {t("loading")}</Panel>;
  if ("error" in ev) return <Panel className="text-[#d12929]">{title}: {ev.error}</Panel>;
  const pr = ev.publicRecords;
  const status = (s: string) => (s === "NoFileReturnedCreditFreeze" ? t("fileFrozen") : s === "NoFileReturnedNoHit" ? t("fileNoHit") : t("fileOther", { s }));
  return (
    <Panel className="space-y-3">
      <div className="text-lg font-semibold tracking-tight">{title}</div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500"><tr><th className="pb-1 font-medium">{t("bureau")}</th><th className="pb-1 font-medium">{t("score")}</th><th className="pb-1 font-medium">{t("model")}</th><th className="pb-1 font-medium">{t("reqId")}</th></tr></thead>
        <tbody>
          {ev.bureaus.map((b) => (
            <tr key={b.bureau} className="border-t border-black/10">
              <td className="py-1.5">{b.bureau}</td>
              <td className="font-semibold tabular-nums">{b.score ?? "—"}</td>
              <td className="text-neutral-500">{b.modelName ?? status(b.fileStatus)}</td>
              <td className="font-mono text-xs text-neutral-400">{b.requestId?.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pr && (
        <div className="text-sm text-neutral-600">
          {t("pitchpoint", { j: pr.judgments.length, l: pr.liens.length, b: pr.bankruptcies })} · <span className="font-mono text-xs text-neutral-400">{pr.requestId?.slice(0, 8)}</span>
        </div>
      )}
    </Panel>
  );
}
