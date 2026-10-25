"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Pillar = {
  id: string;
  title: string;
  sub: string;
  amount: number; // total money flowing on this edge
  late: number; // 0..1 share assumed to arrive late
  riskColor: string;
  inflow: boolean;
  active: boolean;
};

type Props = {
  curve: { day: number; p05: number; p50: number; p95: number }[];
  day: number;
  pillars: Pillar[];
  bTitle: string;
  bSub: string;
  selected: string | null;
  onSelect: (id: string) => void;
  dayWord: string;
  hint: string;
  caption: string;
  progress: number; // 0..1 through the timeline; also steers the camera
  scrollHint: string;
};

const STEP = 3;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

// pillar slots left to right: customers | B | suppliers
const SLOT_X: Record<string, number> = { A: -6.6, D: -3.3, B: 0, C: 3.3, E: 6.6 };
const PILLAR_Z = 3.2;
const SERIES_Z = -4.6;

type Bar = { mesh: THREE.Mesh; cur: [number, number]; tgt: [number, number] };

function makeBar(scene: THREE.Scene, w: number, d: number, color: string, opts: { opacity?: number; shadow?: boolean } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
    transparent: opts.opacity !== undefined,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.opacity === undefined,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat);
  mesh.castShadow = opts.shadow ?? true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const bar: Bar = { mesh, cur: [0, 0], tgt: [0, 0] };
  return bar;
}

function place(bar: Bar) {
  const [y0, y1] = bar.cur;
  bar.mesh.scale.y = Math.max(Math.abs(y1 - y0), 0.015);
  bar.mesh.position.y = (y0 + y1) / 2;
}

function easeBar(bar: Bar, k = 0.14) {
  bar.cur[0] += (bar.tgt[0] - bar.cur[0]) * k;
  bar.cur[1] += (bar.tgt[1] - bar.cur[1]) * k;
  place(bar);
}

export function Bars3D(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    camera.position.set(6.5, 12.5, 21.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    box.prepend(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0.4);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    
    controls.enablePan = false;
    controls.autoRotate = false;
    controls.enableZoom = false; // the wheel scrolls the page instead
    let userUntil = 0;
    controls.addEventListener("start", () => (userUntil = performance.now() + 5000));
    const camGoal = new THREE.Vector3();

    scene.fog = new THREE.Fog(0xf8fafc, 34, 80);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd9ea, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(7, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.radius = 5;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // floor: translucent so negative cash stays visible below it
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 60),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.88 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(90, 90, 0xcbd5e1, 0xe2e8f0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    grid.position.y = 0.002;
    scene.add(grid);

    // time series bars (one per STEP days) plus a thin 5-95% range column
    const n = Math.floor(120 / STEP) + 1;
    const seriesX = (i: number) => (i - (n - 1) / 2) * 0.42;
    const series: Bar[] = [];
    const ranges: Bar[] = [];
    for (let i = 0; i < n; i++) {
      const b = makeBar(scene, 0.34, 0.95, "#0D99FF");
      b.mesh.position.set(seriesX(i), 0, SERIES_Z);
      series.push(b);
      const r = makeBar(scene, 0.09, 0.09, "#874FFF", { opacity: 0.22, shadow: false });
      r.mesh.position.set(seriesX(i), 0, SERIES_Z);
      ranges.push(r);
    }

    // pillars: glass = total amount, solid inner = share assumed late, plus B's cash
    const slots = ["A", "D", "C", "E"];
    const glass: Record<string, Bar> = {};
    const inner: Record<string, Bar> = {};
    const hit: THREE.Object3D[] = [];
    for (const id of slots) {
      const g = makeBar(scene, 1.5, 1.5, "#94a3b8", { opacity: 0.26, shadow: false });
      g.mesh.position.set(SLOT_X[id], 0, PILLAR_Z);
      g.mesh.userData.id = id;
      glass[id] = g;
      hit.push(g.mesh);
      const inn = makeBar(scene, 1.0, 1.0, "#f59e0b");
      inn.mesh.position.set(SLOT_X[id], 0, PILLAR_Z);
      inn.mesh.userData.id = id;
      inner[id] = inn;
      hit.push(inn.mesh);
    }
    const bBar = makeBar(scene, 1.5, 1.5, "#2563eb");
    bBar.mesh.position.set(SLOT_X.B, 0, PILLAR_Z);
    bBar.mesh.userData.id = "B";
    hit.push(bBar.mesh);

    // selection ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.3, 48),
      new THREE.MeshBasicMaterial({ color: 0x0d0d0d, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);

    // HTML labels, positioned from 3D points every frame
    type Lab = { el: HTMLDivElement; pos: THREE.Vector3; below: boolean };
    const labs = new Map<string, Lab>();
    const lab = (key: string, html: string, pos: THREE.Vector3, style = "", below = false) => {
      let l = labs.get(key);
      if (!l) {
        const el = document.createElement("div");
        el.style.cssText =
          "position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;text-align:center;font:600 12px ui-sans-serif,system-ui,sans-serif;color:#0f172a;will-change:transform;";
        box.appendChild(el);
        l = { el, pos: new THREE.Vector3(), below };
        labs.set(key, l);
      }
      if (l.el.dataset.html !== html) {
        l.el.innerHTML = html;
        l.el.dataset.html = html;
      }
      l.el.style.cssText += style;
      l.pos.copy(pos);
      l.below = below;
    };

    const resize = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    // click to select
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const h = ray.intersectObjects(hit, false)[0];
      const id = h?.object.userData.id as string | undefined;
      if (id && id !== "B") live.current.onSelect(id);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    const v = new THREE.Vector3();
    const color = new THREE.Color();
    let raf = 0;
    const tick = (t: number) => {
      const p = live.current;
      const maxCash = Math.max(1, ...p.curve.map((c) => Math.abs(c.p50)));
      const maxAmt = Math.max(1, ...p.pillars.map((x) => x.amount));
      const u = 7 / Math.max(maxCash, maxAmt);
      const cap = 9;
      const clamp = (y: number) => Math.max(-3.2, Math.min(cap, y));

      // series bars rise as days pass
      for (let i = 0; i < n; i++) {
        const d = i * STEP;
        const c = p.curve[Math.min(d, p.curve.length - 1)];
        const shown = d <= p.day;
        const isNow = shown && d + STEP > p.day;
        const y = shown ? clamp(c.p50 * u) : 0;
        series[i].tgt = [0, y];
        ranges[i].tgt = shown ? [clamp(c.p05 * u), clamp(c.p95 * u)] : [0, 0];
        easeBar(series[i]);
        easeBar(ranges[i], 0.1);
        const mat = series[i].mesh.material as THREE.MeshStandardMaterial;
        const base = !shown ? "#D5DEE8" : c.p50 < 0 ? "#FF3737" : isNow ? "#0b6fd1" : "#0D99FF";
        mat.color.lerp(color.set(base), 0.25);
        mat.emissive.set(isNow ? "#0D99FF" : "#000000");
        mat.emissiveIntensity = isNow ? 0.35 : 0;
      }
      const now = p.curve[Math.min(p.day, p.curve.length - 1)];

      // pillars
      for (const pl of p.pillars) {
        const g = glass[pl.id];
        const inn = inner[pl.id];
        if (!g || !inn) continue;
        const pop = pl.active ? 0.35 * (0.5 + 0.5 * Math.sin(t / 140)) : 0;
        g.tgt = [0, clamp(pl.amount * u)];
        inn.tgt = [0, clamp(pl.amount * pl.late * u)];
        easeBar(g);
        easeBar(inn);
        (g.mesh.material as THREE.MeshStandardMaterial).color.set(pl.inflow ? "#24CB71" : "#FF7237");
        const m = inn.mesh.material as THREE.MeshStandardMaterial;
        m.color.lerp(color.set(pl.riskColor), 0.25);
        m.emissive.set(pl.riskColor);
        m.emissiveIntensity = pop;
        lab(
          `p-${pl.id}`,
          `<div style="font-size:13px">${pl.title}</div><div style="font-weight:500;color:#64748b;font-size:11px">${pl.sub}</div><div style="margin-top:2px;color:${pl.inflow ? "#0b6b38" : "#c2410c"}">${money(pl.amount)}</div>`,
          new THREE.Vector3(SLOT_X[pl.id], 0, PILLAR_Z + 1.0),
          "background:#fff;padding:6px 10px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.08);",
          true,
        );
      }
      bBar.tgt = [0, clamp(now.p50 * u)];
      easeBar(bBar);
      const bm = bBar.mesh.material as THREE.MeshStandardMaterial;
      bm.color.lerp(color.set(now.p50 < 0 ? "#FF3737" : "#0D99FF"), 0.2);
      lab(
        "b",
        `<div style="font-size:13px">${p.bTitle}</div><div style="font-weight:500;color:#64748b;font-size:11px">${p.bSub}</div><div style="margin-top:2px;color:${now.p50 < 0 ? "#FF6B6B" : "#58C0FF"}">${money(now.p50)}</div>`,
        new THREE.Vector3(SLOT_X.B, 0, PILLAR_Z + 1.0),
        "background:#fff;padding:6px 10px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.08);",
        true,
      );

      // series labels
      lab(
        "day",
        `${p.dayWord} ${p.day} · <span style="color:${now.p50 < 0 ? "#dc2626" : "#2563eb"}">${money(now.p50)}</span>`,
        new THREE.Vector3(seriesX(Math.min(n - 1, Math.floor(p.day / STEP))), Math.max(0, clamp(now.p50 * u)) + 0.9, SERIES_Z),
        "background:#0d0d0d;color:#fff;padding:4px 10px;border-radius:999px;",
      );
      for (const d of [0, 30, 60, 90, 120]) {
        lab(`t${d}`, `${d}`, new THREE.Vector3(seriesX(d / STEP), 0, SERIES_Z + 1.05), "color:#94a3b8;font-weight:500;");
      }

      // selection ring
      const sel = p.selected;
      ring.visible = !!sel && sel in SLOT_X;
      if (ring.visible && sel) ring.position.set(SLOT_X[sel], 0.01, PILLAR_Z);

      // camera drifts around the scene as time advances, unless the user is dragging
      if (performance.now() > userUntil) {
        const a = -0.35 + 0.8 * p.progress;
        const r = 25 - 4 * p.progress;
        camGoal.set(Math.sin(a) * r, 13 - 2.5 * p.progress, Math.cos(a) * r);
        camera.position.lerp(camGoal, 0.04);
      }
      controls.update();
      renderer.render(scene, camera);

      const w = box.clientWidth;
      const h = box.clientHeight;
      labs.forEach((l) => {
        v.copy(l.pos).project(camera);
        const hidden = v.z > 1;
        l.el.style.display = hidden ? "none" : "block";
        const lw = l.el.offsetWidth / 2 + 4;
        const sx = Math.max(lw, Math.min(w - lw, (v.x * 0.5 + 0.5) * w));
        l.el.style.transform = `translate(${sx.toFixed(1)}px,${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%,${l.below ? "6px" : "-100%"})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      labs.forEach((l) => l.el.remove());
    };
  }, []);

  return (
    <div ref={wrap} className="relative h-[calc(100vh-330px)] max-h-[640px] min-h-[360px] w-full overflow-hidden rounded-[24px] bg-[#EEF3F8]">
      <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-[0_2px_12px_rgba(0,0,0,.08)]">{props.caption}</div>
      <div className="pointer-events-none absolute bottom-2 left-3 text-xs text-slate-400">{props.hint}</div>
      <div className="pointer-events-none absolute right-3 top-3 bottom-3 flex flex-col items-center gap-1 text-[10px] text-slate-400">
        <span>0</span>
        <div className="relative w-1 flex-1 rounded-full bg-slate-200">
          <div className="absolute left-0 top-0 w-1 rounded-full bg-black" style={{ height: `${Math.round(props.progress * 100)}%` }} />
        </div>
        <span>120</span>
      </div>
      <div className="pointer-events-none absolute bottom-2 right-8 text-xs font-medium text-neutral-700">{props.scrollHint} ↓</div>
    </div>
  );
}
