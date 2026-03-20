import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "playrank_v3";
const AUTO_CHECK_INTERVAL_HOURS = 24;

function extractPackage(url) {
  const m = url.match(/[?&]id=([a-zA-Z0-9._]+)/);
  return m ? m[1] : null;
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtFull(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function getLast14Days() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
function shouldAutoCheck(lastCheckedAt) {
  if (!lastCheckedAt) return true;
  const diff = Date.now() - new Date(lastCheckedAt).getTime();
  return diff > AUTO_CHECK_INTERVAL_HOURS * 60 * 60 * 1000;
}

function RankCell({ rank, isToday }) {
  if (rank === undefined || rank === null) {
    return <div style={{ textAlign: "center", color: "#1e3a5f", fontSize: 12 }}>—</div>;
  }
  let bg, color;
  if (rank <= 3) { bg = "#052e16"; color = "#4ade80"; }
  else if (rank <= 10) { bg = "#0c1e40"; color = "#60a5fa"; }
  else if (rank <= 20) { bg = "#2d1b00"; color = "#fbbf24"; }
  else if (rank <= 30) { bg = "#2d1515"; color = "#f87171"; }
  else { bg = "#1a2535"; color = "#64748b"; }
  return (
    <div style={{
      textAlign: "center",
      background: isToday ? bg : "transparent",
      color: isToday ? color : color + "bb",
      fontFamily: "monospace",
      fontWeight: isToday ? 800 : 600,
      fontSize: isToday ? 13 : 12,
      borderRadius: 4,
      padding: "2px 4px",
      border: isToday ? `1px solid ${color}33` : "none",
    }}>
      {rank === "NF" ? <span style={{ color: "#334155", fontSize: 10 }}>NF</span> : `#${rank}`}
    </div>
  );
}

function ChangeBadge({ kw }) {
  const hist = kw.history || {};
  const days = getLast14Days();
  const ranked = days.map(d => hist[d]?.rank).filter(Boolean);
  if (ranked.length < 2) return <span style={{ color: "#334155", fontSize: 12 }}>—</span>;
  const latest = ranked[ranked.length - 1];
  const prev = ranked[ranked.length - 2];
  const diff = prev - latest;
  if (diff === 0) return <span style={{ color: "#475569", fontSize: 12, fontWeight: 600 }}>→ 0</span>;
  if (diff > 0) return <span style={{ color: "#4ade80", fontSize: 12, fontWeight: 700 }}>↑ {diff}</span>;
  return <span style={{ color: "#f87171", fontSize: 12, fontWeight: 700 }}>↓ {Math.abs(diff)}</span>;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default function Home() {
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeId, setActiveId] = useState(null);
  const [modal, setModal] = useState(null);
  const [newApp, setNewApp] = useState({ name: "", url: "" });
  const [bulkKw, setBulkKw] = useState("");
  const [appError, setAppError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ done: 0, total: 0 });
  const [autoChecking, setAutoChecking] = useState(false);
  const [lastAutoCheck, setLastAutoCheck] = useState(null);
  const autoCheckRan = useRef(false);

  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      setProjects(d.projects || []);
      setLastAutoCheck(d.lastAutoCheck || null);
    } catch {}
  }, []);

  const save = useCallback((updatedProjects, lastAC) => {
    setProjects(updatedProjects);
    const payload = { projects: updatedProjects, lastAutoCheck: lastAC };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, []);

  const activeProject = projects.find(p => p.id === activeId);

  useEffect(() => {
    if (autoCheckRan.current) return;
    if (!shouldAutoCheck(lastAutoCheck)) return;
    if (projects.length === 0) return;
    autoCheckRan.current = true;
    runAutoCheck(projects);
  }, [projects, lastAutoCheck]);

  const checkAllForProject = async (proj, currentProjects) => {
    const kws = proj.keywords;
    let updated = [...currentProjects];
    setCheckProgress({ done: 0, total: kws.length });
    for (let i = 0; i < kws.length; i++) {
      const kw = kws[i];
      try {
        const res = await fetch("/api/check-rank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: kw.text, packageId: proj.packageId }),
        });
        const data = await res.json();
        const today = todayKey();
        const histEntry = { rank: data.rank || "NF", found: data.found, checkedAt: data.checkedAt };
        updated = updated.map(p =>
          p.id === proj.id
            ? {
                ...p,
                keywords: p.keywords.map(k =>
                  k.id === kw.id
                    ? { ...k, rank: data.rank || null, found: data.found, lastChecked: data.checkedAt, history: { ...(k.history || {}), [today]: histEntry } }
                    : k
                ),
                lastChecked: new Date().toISOString(),
              }
            : p
        );
        setProjects([...updated]);
      } catch (e) {
        console.error("check failed:", kw.text, e);
      }
      setCheckProgress({ done: i + 1, total: kws.length });
      await sleep(500);
    }
    return updated;
  };

  const runAutoCheck = async (projs) => {
    setAutoChecking(true);
    let updatedProjects = [...projs];
    for (const proj of updatedProjects) {
      if (!proj.keywords?.length) continue;
      updatedProjects = await checkAllForProject(proj, updatedProjects);
    }
    const now = new Date().toISOString();
    setLastAutoCheck(now);
    save(updatedProjects, now);
    setAutoChecking(false);
  };

  const handleCheckAll = async () => {
    if (!activeProject || checking) return;
    setChecking(true);
    const updated = await checkAllForProject(activeProject, projects);
    const now = new Date().toISOString();
    save(updated, now);
    setChecking(false);
    setCheckProgress({ done: 0, total: 0 });
  };

  const addProject = () => {
    setAppError("");
    const pkg = extractPackage(newApp.url);
    if (!pkg) { setAppError("Invalid URL — must contain ?id=com.package.name"); return; }
    if (!newApp.name.trim()) { setAppError("App name is required"); return; }
    const proj = {
      id: Date.now().toString(),
      name: newApp.name.trim(),
      url: newApp.url.trim(),
      packageId: pkg,
      createdAt: new Date().toISOString(),
      keywords: [],
      lastChecked: null,
    };
    const updated = [...projects, proj];
    save(updated, lastAutoCheck);
    setNewApp({ name: "", url: "" });
    setModal(null);
  };

  const addKeywords = () => {
    if (!bulkKw.trim() || !activeProject) return;
    const lines = bulkKw.split("\n").map(l => l.trim()).filter(Boolean);
    const existing = new Set(activeProject.keywords.map(k => k.text.toLowerCase()));
    const toAdd = lines
      .filter(l => !existing.has(l.toLowerCase()))
      .map(text => ({
        id: `${Date.now()}${Math.random().toString(36).slice(2)}`,
        text,
        rank: null,
        found: false,
        lastChecked: null,
        history: {},
      }));
    const updated = projects.map(p =>
      p.id === activeProject.id ? { ...p, keywords: [...p.keywords, ...toAdd] } : p
    );
    save(updated, lastAutoCheck);
    setBulkKw("");
    setModal(null);
  };

  const removeKeyword = (kwId) => {
    const updated = projects.map(p =>
      p.id === activeId ? { ...p, keywords: p.keywords.filter(k => k.id !== kwId) } : p
    );
    save(updated, lastAutoCheck);
  };

  const removeProject = (id) => {
    const updated = projects.filter(p => p.id !== id);
    save(updated, lastAutoCheck);
    if (activeId === id) { setView("dashboard"); setActiveId(null); }
  };

  const days14 = getLast14Days();

  const S = {
    app: { minHeight: "100vh", background: "#04080f", color: "#94a3b8", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" },
    topbar: { background: "#060d1a", borderBottom: "1px solid #0d1f35", height: 52, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 },
    logo: { display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 16, color: "#e2e8f0", letterSpacing: "-0.5px" },
    dot: { width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg,#1d4ed8,#0891b2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 },
    page: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px" },
    btn: (v = "p") => ({
      padding: "7px 14px", borderRadius: 6, border: "none",
      cursor: "pointer", fontWeight: 600, fontSize: 12, fontFamily: "inherit",
      transition: "opacity .15s",
      background: v === "p" ? "linear-gradient(135deg,#1d4ed8,#0284c7)" : v === "ghost" ? "transparent" : v === "danger" ? "#160505" : "#0d1f35",
      color: v === "danger" ? "#f87171" : v === "ghost" ? "#475569" : "#f1f5f9",
      border: v === "ghost" ? "1px solid #0d1f35" : "none",
    }),
    projCard: { background: "#060d1a", border: "1px solid #0d1f35", borderRadius: 10, padding: "14px 16px", marginBottom: 8, cursor: "pointer", transition: "border-color .2s", display: "flex", justifyContent: "space-between", alignItems: "center" },
    tag: { background: "#0a1628", borderRadius: 4, padding: "1px 8px", fontSize: 11, color: "#334155" },
    modal: { position: "fixed", inset: 0, background: "#000000dd", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 },
    mbox: { background: "#060d1a", border: "1px solid #1e3a5f", borderRadius: 12, padding: "22px 20px", width: "100%", maxWidth: 460 },
    input: { background: "#04080f", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" },
    textarea: { background: "#04080f", border: "1px solid #1e3a5f", borderRadius: 6, padding: "8px 12px", color: "#e2e8f0", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box", minHeight: 150, resize: "vertical" },
    label: { fontSize: 10, color: "#334155", marginBottom: 4, display: "block", fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase" },
    row: { display: "flex", alignItems: "center", gap: 8 },
  };

  if (view === "dashboard") return (
    <div style={S.app}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}`}</style>
      <div style={S.topbar}>
        <div style={S.logo}><div style={S.dot}>📊</div>PlayRank</div>
        <div style={S.row}>
          {autoChecking && <span style={{ fontSize: 11, color: "#60a5fa", background: "#0c1e40", borderRadius: 5, padding: "3px 10px" }}>⏳ Auto-checking {checkProgress.done}/{checkProgress.total}…</span>}
          {lastAutoCheck && !autoChecking && <span style={{ fontSize: 11, color: "#334155" }}>Last check: {fmtFull(lastAutoCheck)}</span>}
          <button style={S.btn()} onClick={() => setModal("addProject")}>+ Add App</button>
        </div>
      </div>
      <div style={S.page}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#e2e8f0", marginBottom: 3 }}>Your Apps</div>
          <div style={{ fontSize: 12, color: "#1e3a5f" }}>Rankings auto-update daily · {projects.length} app{projects.length !== 1 ? "s" : ""} tracked</div>
        </div>
        {projects.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📱</div>
            <div style={{ color: "#1e3a5f", fontSize: 14, fontWeight: 600 }}>No apps yet. Add your first Play Store app.</div>
          </div>
        )}
        {projects.map(p => {
          const ranked = p.keywords.filter(k => k.rank).length;
          return (
            <div key={p.id} style={S.projCard}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#1d4ed8"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#0d1f35"}
              onClick={() => { setActiveId(p.id); setView("project"); }}>
              <div>
                <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14, marginBottom: 2 }}>{p.name}</div>
                <div style={{ fontSize: 10, color: "#1e3a5f", fontFamily: "monospace" }}>{p.packageId}</div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={S.tag}>🔑 {p.keywords.length} kw</span>
                <span style={S.tag}>✅ {ranked} ranked</span>
                <span style={{ fontSize: 11, color: "#1e3a5f" }}>{p.lastChecked ? fmtFull(p.lastChecked) : "Not checked"}</span>
                <button style={{ ...S.btn("danger"), padding: "4px 8px", fontSize: 11 }}
                  onClick={e => { e.stopPropagation(); if (confirm(`Delete "${p.name}"?`)) removeProject(p.id); }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
      {modal === "addProject" && (
        <div style={S.modal} onClick={() => setModal(null)}>
          <div style={S.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginBottom: 16 }}>Add Play Store App</div>
            {appError && <div style={{ background: "#160505", color: "#f87171", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 12 }}>{appError}</div>}
            <div style={{ marginBottom: 10 }}>
              <label style={S.label}>App Name</label>
              <input style={S.input} placeholder="e.g. WhatsApp" value={newApp.name} onChange={e => setNewApp({ ...newApp, name: e.target.value })} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Play Store URL</label>
              <input style={S.input} placeholder="https://play.google.com/store/apps/details?id=com.whatsapp" value={newApp.url} onChange={e => setNewApp({ ...newApp, url: e.target.value })} />
            </div>
            <div style={S.row}>
              <button style={S.btn()} onClick={addProject}>Add App</button>
              <button style={S.btn("ghost")} onClick={() => { setModal(null); setAppError(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (!activeProject) { setView("dashboard"); return null; }
  const ranked = activeProject.keywords.filter(k => k.rank).length;
  const notFound = activeProject.keywords.filter(k => k.lastChecked && !k.rank).length;

  return (
    <div style={S.app}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{height:4px;width:4px}::-webkit-scrollbar-track{background:#04080f}::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:4px}`}</style>
      <div style={S.topbar}>
        <div style={S.row}>
          <button style={{ ...S.btn("ghost"), padding: "5px 10px", fontSize: 11 }} onClick={() => { setView("dashboard"); setActiveId(null); }}>← Back</button>
          <div style={S.logo}><div style={S.dot}>📊</div>PlayRank</div>
        </div>
        <div style={S.row}>
          {checking && <span style={{ fontSize: 11, color: "#60a5fa", background: "#0c1e40", borderRadius: 5, padding: "3px 10px" }}>⏳ {checkProgress.done}/{checkProgress.total} checked</span>}
          <button style={S.btn("s")} onClick={() => setModal("addKeyword")}>+ Add Keywords</button>
          <button style={{ ...S.btn(), opacity: checking ? 0.5 : 1 }} disabled={checking || !activeProject.keywords.length} onClick={handleCheckAll}>
            {checking ? "Checking…" : "🔄 Check Now"}
          </button>
        </div>
      </div>
      <div style={{ background: "#060d1a", borderBottom: "1px solid #0d1f35", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#e2e8f0" }}>{activeProject.name}</span>
          <span style={{ fontSize: 10, color: "#1e3a5f", fontFamily: "monospace", marginLeft: 10 }}>{activeProject.packageId}</span>
          <a href={activeProject.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#1d4ed8", marginLeft: 10, textDecoration: "none" }}>↗ Store</a>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={S.tag}>🔑 {activeProject.keywords.length} keywords</span>
          <span style={{ ...S.tag, color: "#4ade80" }}>✅ {ranked} ranked</span>
          <span style={{ ...S.tag, color: "#f87171" }}>❌ {notFound} not found</span>
          <span style={S.tag}>🕐 {activeProject.lastChecked ? fmtFull(activeProject.lastChecked) : "Not checked"}</span>
          <span style={{ ...S.tag, color: "#60a5fa" }}>⚡ Daily auto-check ON</span>
        </div>
      </div>
      <div style={{ padding: "16px", overflowX: "auto" }}>
        {activeProject.keywords.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#1e3a5f" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13 }}>No keywords yet. Click "Add Keywords" to get started.</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#060d1a", borderBottom: "2px solid #0d1f35" }}>
                <th style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", minWidth: 180, position: "sticky", left: 0, background: "#060d1a", zIndex: 2 }}>Keyword</th>
                <th style={{ textAlign: "center", padding: "9px 8px", fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", minWidth: 70 }}>Current</th>
                <th style={{ textAlign: "center", padding: "9px 8px", fontSize: 10, color: "#334155", fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", minWidth: 60 }}>Change</th>
                {days14.map(day => (
                  <th key={day} style={{ textAlign: "center", padding: "9px 6px", fontSize: 9, color: day === todayKey() ? "#60a5fa" : "#1e3a5f", fontWeight: day === todayKey() ? 800 : 600, minWidth: 42, borderLeft: "1px solid #080f1e", background: day === todayKey() ? "#080e20" : "transparent" }}>
                    {fmtDate(day)}
                    {day === todayKey() && <div style={{ fontSize: 8, color: "#1d4ed8" }}>TODAY</div>}
                  </th>
                ))}
                <th style={{ padding: "9px 8px", minWidth: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {activeProject.keywords.map((kw, idx) => (
                <tr key={kw.id}
                  style={{ background: idx % 2 === 0 ? "#04080f" : "#050b15", borderBottom: "1px solid #080f1e", transition: "background .15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#070e1c"}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "#04080f" : "#050b15"}>
                  <td style={{ padding: "8px 12px", position: "sticky", left: 0, background: "inherit", zIndex: 1 }}>
                    <div style={{ fontWeight: 600, color: "#cbd5e1", fontSize: 13 }}>{kw.text}</div>
                    <div style={{ fontSize: 9, color: "#1e3a5f", marginTop: 1 }}>{kw.lastChecked ? `checked ${fmtFull(kw.lastChecked)}` : "not checked"}</div>
                  </td>
                  <td style={{ padding: "6px 8px" }}><RankCell rank={kw.rank} isToday={true} /></td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}><ChangeBadge kw={kw} /></td>
                  {days14.map(day => {
                    const entry = kw.history?.[day];
                    return (
                      <td key={day} style={{ padding: "6px 4px", borderLeft: "1px solid #080f1e", background: day === todayKey() ? "#070d1a" : "transparent" }}>
                        <RankCell rank={entry?.rank} isToday={day === todayKey()} />
                      </td>
                    );
                  })}
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#1e3a5f", fontSize: 12, padding: "2px 6px" }} onClick={() => removeKeyword(kw.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {activeProject.keywords.length > 0 && (
        <div style={{ display: "flex", gap: 12, padding: "8px 16px 16px", flexWrap: "wrap" }}>
          {[["#4ade80", "#1–3"], ["#60a5fa", "#4–10"], ["#fbbf24", "#11–20"], ["#f87171", "#21–30"], ["#475569", "NF"]].map(([color, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#334155" }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }}></div>
              {label}
            </div>
          ))}
        </div>
      )}
      {modal === "addKeyword" && (
        <div style={S.modal} onClick={() => setModal(null)}>
          <div style={S.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>Add Keywords</div>
            <div style={{ fontSize: 12, color: "#334155", marginBottom: 14 }}>Paste one keyword per line. Bulk add supported.</div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Keywords (one per line)</label>
              <textarea style={S.textarea} placeholder={"photo editor\nvideo trimmer\nimage resizer\n..."} value={bulkKw} onChange={e => setBulkKw(e.target.value)} autoFocus />
              <div style={{ fontSize: 10, color: "#1e3a5f", marginTop: 4 }}>{bulkKw.split("\n").filter(l => l.trim()).length} keywords ready to add</div>
            </div>
            <div style={S.row}>
              <button style={S.btn()} onClick={addKeywords}>Add Keywords</button>
              <button style={S.btn("ghost")} onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  }
