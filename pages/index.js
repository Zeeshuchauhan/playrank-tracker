// pages/index.js
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "playrank_v2";

function extractPackage(url) {
  const m = url.match(/[?&]id=([a-zA-Z0-9._]+)/);
  return m ? m[1] : null;
}

function fmt(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RankBadge({ rank, small }) {
  let bg, color, label;
  if (!rank) { bg = "#1e293b"; color = "#475569"; label = "—"; }
  else if (rank <= 3) { bg = "#052e16"; color = "#22c55e"; label = `#${rank}`; }
  else if (rank <= 10) { bg = "#0c1a3a"; color = "#60a5fa"; label = `#${rank}`; }
  else if (rank <= 20) { bg = "#2d1b00"; color = "#f59e0b"; label = `#${rank}`; }
  else if (rank <= 30) { bg = "#2d1515"; color = "#f87171"; label = `#${rank}`; }
  else { bg = "#1e293b"; color = "#475569"; label = `#${rank}`; }
  return (
    <span style={{
      background: bg, color, borderRadius: 6,
      padding: small ? "1px 7px" : "3px 11px",
      fontFamily: "monospace", fontWeight: 800,
      fontSize: small ? 11 : 13, display: "inline-block",
      border: `1px solid ${color}33`,
    }}>{label}</span>
  );
}

function Trend({ history }) {
  if (!history || history.length < 2) return null;
  const last = history[history.length - 1]?.rank;
  const prev = history[history.length - 2]?.rank;
  if (!last || !prev) return null;
  const diff = prev - last; // positive = improved
  if (diff === 0) return <span style={{ color: "#64748b", fontSize: 12 }}>→</span>;
  if (diff > 0) return <span style={{ color: "#22c55e", fontSize: 12 }}>↑{diff}</span>;
  return <span style={{ color: "#f87171", fontSize: 12 }}>↓{Math.abs(diff)}</span>;
}

export default function Home() {
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeId, setActiveId] = useState(null);
  const [modal, setModal] = useState(null); // "addProject" | "addKeyword" | "history"
  const [historyKw, setHistoryKw] = useState(null);
  const [newApp, setNewApp] = useState({ name: "", url: "" });
  const [bulkKeywords, setBulkKeywords] = useState("");
  const [appError, setAppError] = useState("");
  const [checking, setChecking] = useState({}); // kwId -> bool
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total }
  const [activeTab, setActiveTab] = useState("keywords"); // keywords | history

  // Load from localStorage
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setProjects(d);
    } catch {}
  }, []);

  // Save to localStorage
  const save = useCallback((updated) => {
    setProjects(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const activeProject = projects.find(p => p.id === activeId);

  // ── Add project
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
    };
    save([...projects, proj]);
    setNewApp({ name: "", url: "" });
    setModal(null);
  };

  // ── Add keywords (bulk)
  const addKeywords = () => {
    if (!bulkKeywords.trim() || !activeProject) return;
    const lines = bulkKeywords.split("\n").map(l => l.trim()).filter(Boolean);
    const existing = new Set(activeProject.keywords.map(k => k.text.toLowerCase()));
    const toAdd = lines.filter(l => !existing.has(l.toLowerCase())).map(text => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      text,
      rank: null,
      found: false,
      checkedAt: null,
      history: [],
    }));
    if (!toAdd.length) { setBulkKeywords(""); setModal(null); return; }
    const updated = projects.map(p =>
      p.id === activeProject.id ? { ...p, keywords: [...p.keywords, ...toAdd] } : p
    );
    save(updated);
    setBulkKeywords("");
    setModal(null);
  };

  // ── Check single keyword rank
  const checkKeyword = async (project, kw) => {
    setChecking(c => ({ ...c, [kw.id]: true }));
    try {
      const res = await fetch("/api/check-rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw.text, packageId: project.packageId }),
      });
      const data = await res.json();
      const checkedAt = new Date().toISOString();
      const histEntry = { date: checkedAt, rank: data.rank || null, found: data.found };

      const updated = projects.map(p =>
        p.id === project.id
          ? {
              ...p,
              keywords: p.keywords.map(k =>
                k.id === kw.id
                  ? {
                      ...k,
                      rank: data.rank || null,
                      found: data.found,
                      checkedAt,
                      totalScanned: data.totalScanned || 0,
                      history: [...(k.history || []), histEntry].slice(-90), // keep 90 days
                    }
                  : k
              ),
            }
          : p
      );
      save(updated);
    } catch (e) {
      console.error(e);
    }
    setChecking(c => ({ ...c, [kw.id]: false }));
  };

  // ── Check all keywords for active project
  const checkAll = async () => {
    if (!activeProject) return;
    const kws = activeProject.keywords;
    setBulkProgress({ done: 0, total: kws.length });
    for (let i = 0; i < kws.length; i++) {
      // Re-fetch latest project state each time
      const latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const proj = latest.find(p => p.id === activeProject.id);
      if (proj) await checkKeyword(proj, proj.keywords[i]);
      setBulkProgress({ done: i + 1, total: kws.length });
    }
    setBulkProgress(null);
  };

  // ── Remove keyword
  const removeKeyword = (kwId) => {
    const updated = projects.map(p =>
      p.id === activeId ? { ...p, keywords: p.keywords.filter(k => k.id !== kwId) } : p
    );
    save(updated);
  };

  // ── Remove project
  const removeProject = (id) => {
    save(projects.filter(p => p.id !== id));
    if (activeId === id) { setView("dashboard"); setActiveId(null); }
  };

  // ─────────────────────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────────────────────
  const C = {
    app: { minHeight: "100vh", background: "#060b14", color: "#cbd5e1", fontFamily: "'Inter', system-ui, sans-serif" },
    topbar: {
      background: "#080f1e", borderBottom: "1px solid #0f2040",
      padding: "0 24px", height: 54,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "sticky", top: 0, zIndex: 50,
    },
    logo: { display: "flex", alignItems: "center", gap: 9, fontWeight: 800, fontSize: 17, color: "#f1f5f9", letterSpacing: "-0.3px" },
    logoDot: { width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#2563eb,#06b6d4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 },
    page: { maxWidth: 1000, margin: "0 auto", padding: "28px 18px" },
    h1: { fontSize: 20, fontWeight: 700, color: "#f1f5f9", marginBottom: 4 },
    sub: { fontSize: 13, color: "#475569" },
    card: {
      background: "#0b1525", border: "1px solid #0f2040", borderRadius: 12,
      padding: "16px 18px", marginBottom: 10,
      transition: "border-color .2s, box-shadow .2s",
      cursor: "pointer",
    },
    kwCard: {
      background: "#0a1320", border: "1px solid #0f2040", borderRadius: 10,
      padding: "11px 14px", marginBottom: 8,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    },
    btn: (v = "p") => ({
      padding: "8px 16px", borderRadius: 7, border: "none",
      cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: "inherit",
      background: v === "p" ? "linear-gradient(135deg,#2563eb,#0891b2)"
        : v === "r" ? "#1f0a0a" : v === "g" ? "transparent" : "#0f2040",
      color: v === "r" ? "#f87171" : v === "g" ? "#64748b" : "#fff",
      border: v === "g" ? "1px solid #0f2040" : "none",
      transition: "opacity .15s",
    }),
    input: {
      background: "#060e1c", border: "1px solid #1e3a5f",
      borderRadius: 7, padding: "9px 13px", color: "#e2e8f0",
      fontSize: 14, fontFamily: "inherit", outline: "none",
      width: "100%", boxSizing: "border-box",
    },
    textarea: {
      background: "#060e1c", border: "1px solid #1e3a5f",
      borderRadius: 7, padding: "9px 13px", color: "#e2e8f0",
      fontSize: 13, fontFamily: "monospace", outline: "none",
      width: "100%", boxSizing: "border-box", minHeight: 140, resize: "vertical",
    },
    label: { fontSize: 11, color: "#475569", marginBottom: 5, display: "block", fontWeight: 600, letterSpacing: "0.6px", textTransform: "uppercase" },
    modal: { position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 },
    mbox: { background: "#0b1525", border: "1px solid #1e3a5f", borderRadius: 14, padding: "24px 22px", width: "100%", maxWidth: 460 },
    tag: { background: "#0f2040", borderRadius: 5, padding: "2px 9px", fontSize: 11, color: "#64748b", display: "inline-block" },
    row: { display: "flex", alignItems: "center", gap: 8 },
    tabs: { display: "flex", gap: 2, background: "#060e1c", borderRadius: 8, padding: 3, marginBottom: 18 },
    tab: (active) => ({
      padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600,
      cursor: "pointer", border: "none", fontFamily: "inherit",
      background: active ? "#0f2040" : "transparent",
      color: active ? "#60a5fa" : "#475569",
    }),
  };

  // ─────────────────────────────────────────────────────────────
  // HISTORY MODAL
  // ─────────────────────────────────────────────────────────────
  const HistoryModal = () => {
    if (!historyKw) return null;
    const hist = [...(historyKw.history || [])].reverse();
    return (
      <div style={C.modal} onClick={() => { setModal(null); setHistoryKw(null); }}>
        <div style={{ ...C.mbox, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: "#f1f5f9" }}>Rank History</div>
          <div style={{ fontSize: 13, color: "#475569", marginBottom: 18 }}>"{historyKw.text}"</div>
          {hist.length === 0 ? (
            <div style={{ color: "#475569", fontSize: 13, padding: "20px 0" }}>No history yet. Run a check first.</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "#475569", borderBottom: "1px solid #0f2040" }}>
                    <th style={{ textAlign: "left", padding: "6px 10px" }}>Date</th>
                    <th style={{ textAlign: "center", padding: "6px 10px" }}>Rank</th>
                    <th style={{ textAlign: "center", padding: "6px 10px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hist.map((h, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #0a1320" }}>
                      <td style={{ padding: "8px 10px", color: "#94a3b8" }}>{fmt(h.date)}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}><RankBadge rank={h.rank} small /></td>
                      <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 11 }}>
                        {h.found ? <span style={{ color: "#22c55e" }}>Found</span> : <span style={{ color: "#f87171" }}>Not Found</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button style={C.btn("g")} onClick={() => { setModal(null); setHistoryKw(null); }}>Close</button>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // DASHBOARD
  // ─────────────────────────────────────────────────────────────
  if (view === "dashboard") return (
    <div style={C.app}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } body { background: #060b14; }`}</style>

      <div style={C.topbar}>
        <div style={C.logo}>
          <div style={C.logoDot}>📊</div>
          PlayRank Tracker
        </div>
        <button style={C.btn()} onClick={() => setModal("addProject")}>+ Add App</button>
      </div>

      <div style={C.page}>
        <div style={{ marginBottom: 24 }}>
          <div style={C.h1}>Your Apps</div>
          <div style={C.sub}>{projects.length} app{projects.length !== 1 ? "s" : ""} • Real Play Store rank tracking</div>
        </div>

        {projects.length === 0 && (
          <div style={{ textAlign: "center", padding: "70px 20px" }}>
            <div style={{ fontSize: 42, marginBottom: 12 }}>📱</div>
            <div style={{ color: "#334155", fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No apps added yet</div>
            <div style={{ color: "#1e3a5f", fontSize: 13 }}>Add your first Play Store app to start tracking keyword rankings</div>
          </div>
        )}

        {projects.map(p => {
          const ranked = p.keywords.filter(k => k.rank).length;
          const lastCheck = p.keywords.reduce((acc, k) => k.checkedAt && (!acc || k.checkedAt > acc) ? k.checkedAt : acc, null);
          return (
            <div key={p.id} style={C.card}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#1e4a8a"; e.currentTarget.style.boxShadow = "0 0 0 1px #1e4a8a22"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#0f2040"; e.currentTarget.style.boxShadow = ""; }}
              onClick={() => { setActiveId(p.id); setView("project"); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9", marginBottom: 2 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#334155", fontFamily: "monospace" }}>{p.packageId}</div>
                </div>
                <button style={{ ...C.btn("r"), padding: "4px 9px", fontSize: 11 }}
                  onClick={e => { e.stopPropagation(); if (confirm(`Delete "${p.name}"?`)) removeProject(p.id); }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                <span style={C.tag}>🔑 {p.keywords.length} keywords</span>
                <span style={C.tag}>✅ {ranked} ranked</span>
                <span style={C.tag}>🕐 {lastCheck ? fmt(lastCheck) : "Not checked"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Project Modal */}
      {modal === "addProject" && (
        <div style={C.modal} onClick={() => setModal(null)}>
          <div style={C.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#f1f5f9", marginBottom: 18 }}>Add Play Store App</div>
            {appError && <div style={{ background: "#2d0a0a", color: "#f87171", borderRadius: 7, padding: "9px 13px", marginBottom: 12, fontSize: 13 }}>{appError}</div>}
            <div style={{ marginBottom: 12 }}>
              <label style={C.label}>App Name</label>
              <input style={C.input} placeholder="e.g. WhatsApp" value={newApp.name}
                onChange={e => setNewApp({ ...newApp, name: e.target.value })} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={C.label}>Play Store URL</label>
              <input style={C.input}
                placeholder="https://play.google.com/store/apps/details?id=com.whatsapp"
                value={newApp.url} onChange={e => setNewApp({ ...newApp, url: e.target.value })} />
            </div>
            <div style={C.row}>
              <button style={C.btn()} onClick={addProject}>Add App</button>
              <button style={C.btn("g")} onClick={() => { setModal(null); setAppError(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // PROJECT DETAIL
  // ─────────────────────────────────────────────────────────────
  if (!activeProject) { setView("dashboard"); return null; }
  const isAnyChecking = activeProject.keywords.some(k => checking[k.id]) || bulkProgress;

  return (
    <div style={C.app}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } body { background: #060b14; } ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: #060b14; } ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 4px; }`}</style>

      <div style={C.topbar}>
        <div style={C.row}>
          <button style={{ ...C.btn("g"), padding: "6px 12px", fontSize: 12 }} onClick={() => { setView("dashboard"); setActiveId(null); }}>← Back</button>
          <div style={C.logo}>
            <div style={C.logoDot}>📊</div>
            PlayRank Tracker
          </div>
        </div>
        <div style={C.row}>
          <button style={C.btn("s")} onClick={() => setModal("addKeyword")}>+ Add Keywords</button>
          <button style={{ ...C.btn(), opacity: isAnyChecking ? 0.5 : 1 }}
            disabled={!!isAnyChecking || activeProject.keywords.length === 0}
            onClick={checkAll}>
            {bulkProgress ? `⏳ ${bulkProgress.done}/${bulkProgress.total}` : "🔄 Check All"}
          </button>
        </div>
      </div>

      <div style={C.page}>
        {/* App info bar */}
        <div style={{ ...C.card, cursor: "default", marginBottom: 22, background: "#080f1e" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{activeProject.name}</div>
              <div style={{ fontSize: 11, color: "#334155", fontFamily: "monospace", marginTop: 2 }}>{activeProject.packageId}</div>
              <a href={activeProject.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none", display: "inline-block", marginTop: 4 }}>
                View on Play Store ↗
              </a>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={C.tag}>🔑 {activeProject.keywords.length} keywords</span>
              <span style={C.tag}>✅ {activeProject.keywords.filter(k => k.rank).length} ranked</span>
              <span style={C.tag}>❌ {activeProject.keywords.filter(k => k.checkedAt && !k.rank).length} not found</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={C.tabs}>
          <button style={C.tab(activeTab === "keywords")} onClick={() => setActiveTab("keywords")}>Keywords</button>
          <button style={C.tab(activeTab === "history")} onClick={() => setActiveTab("history")}>Rank History</button>
        </div>

        {/* KEYWORDS TAB */}
        {activeTab === "keywords" && (
          <>
            {activeProject.keywords.length === 0 && (
              <div style={{ textAlign: "center", padding: "50px 0", color: "#1e3a5f" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                <div style={{ fontSize: 14, color: "#334155" }}>No keywords yet. Add some to start tracking.</div>
              </div>
            )}

            {/* Table header */}
            {activeProject.keywords.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 80px 130px 100px", gap: 8, padding: "6px 14px", fontSize: 11, color: "#334155", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 4 }}>
                <div>Keyword</div>
                <div style={{ textAlign: "center" }}>Rank</div>
                <div style={{ textAlign: "center" }}>Trend</div>
                <div>Last Checked</div>
                <div>Actions</div>
              </div>
            )}

            {activeProject.keywords.map(kw => (
              <div key={kw.id} style={C.kwCard}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#e2e8f0", marginBottom: 1 }}>{kw.text}</div>
                  <div style={{ fontSize: 11, color: "#334155" }}>
                    {kw.checkedAt ? `Checked ${fmt(kw.checkedAt)}` : "Not checked yet"}
                    {kw.totalScanned ? ` · ${kw.totalScanned} results scanned` : ""}
                  </div>
                </div>
                <div style={{ width: 90, textAlign: "center" }}>
                  <RankBadge rank={kw.rank} />
                </div>
                <div style={{ width: 80, textAlign: "center" }}>
                  <Trend history={kw.history} />
                </div>
                <div style={{ width: 130, fontSize: 11, color: "#475569" }}>
                  {kw.checkedAt ? fmtDate(kw.checkedAt) : "—"}
                </div>
                <div style={{ width: 100, display: "flex", gap: 5 }}>
                  <button title="Check Rank" style={{ ...C.btn("s"), padding: "5px 9px", opacity: checking[kw.id] ? 0.5 : 1 }}
                    disabled={!!checking[kw.id]} onClick={() => checkKeyword(activeProject, kw)}>
                    {checking[kw.id] ? "⏳" : "🔄"}
                  </button>
                  <button title="History" style={{ ...C.btn("s"), padding: "5px 9px" }}
                    onClick={() => { setHistoryKw(kw); setModal("history"); }}>📈</button>
                  <button title="Remove" style={{ ...C.btn("r"), padding: "5px 9px" }}
                    onClick={() => { if (confirm(`Remove keyword "${kw.text}"?`)) removeKeyword(kw.id); }}>✕</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <>
            <div style={{ marginBottom: 14, fontSize: 13, color: "#475569" }}>
              Full rank history across all keywords — sorted by most recently checked
            </div>
            {activeProject.keywords
              .filter(k => k.history && k.history.length > 0)
              .sort((a, b) => (b.checkedAt || "") > (a.checkedAt || "") ? 1 : -1)
              .map(kw => (
                <div key={kw.id} style={{ ...C.card, cursor: "default", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{kw.text}</div>
                    <RankBadge rank={kw.rank} small />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[...kw.history].reverse().slice(0, 14).map((h, i) => (
                      <div key={i} title={fmt(h.date)} style={{ textAlign: "center" }}>
                        <RankBadge rank={h.rank} small />
                        <div style={{ fontSize: 9, color: "#334155", marginTop: 2 }}>
                          {new Date(h.date).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            {activeProject.keywords.every(k => !k.history || k.history.length === 0) && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#1e3a5f" }}>
                <div style={{ fontSize: 14, color: "#334155" }}>No history yet. Run some rank checks first.</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Keywords Modal */}
      {modal === "addKeyword" && (
        <div style={C.modal} onClick={() => setModal(null)}>
          <div style={C.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>Add Keywords</div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>One keyword per line. Bulk add supported.</div>
            <div style={{ marginBottom: 18 }}>
              <label style={C.label}>Keywords (one per line)</label>
              <textarea style={C.textarea}
                placeholder={"photo editor\nvideo trimmer\nimage converter\n..."}
                value={bulkKeywords}
                onChange={e => setBulkKeywords(e.target.value)}
                autoFocus
              />
              <div style={{ fontSize: 11, color: "#334155", marginTop: 5 }}>
                {bulkKeywords.split("\n").filter(l => l.trim()).length} keywords to add
              </div>
            </div>
            <div style={C.row}>
              <button style={C.btn()} onClick={addKeywords}>Add Keywords</button>
              <button style={C.btn("g")} onClick={() => setModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {modal === "history" && <HistoryModal />}
    </div>
  );
}
