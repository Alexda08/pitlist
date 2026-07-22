import { useState, useEffect, useRef, useCallback } from "react";
import {
  emptyData, createGarage, fetchGarage, mutateGarage, subscribeGarage,
} from "./storage.js";

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const STATUSES = ["pendiente", "pedido", "recibido"];

function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}
function eur(n) {
  return (Math.round(n * 100) / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function codeFromHash() {
  const m = window.location.hash.match(/g=([A-Z0-9]{4,10})/i);
  return m ? m[1].toUpperCase() : null;
}

/* ---------- Landing: crear o entrar a un garaje ---------- */
function Landing({ onEnter, error }) {
  const [join, setJoin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error || "");

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const code = await createGarage();
      onEnter(code);
    } catch (e) {
      setErr("No se pudo crear el garaje. ¿Config de Supabase correcta?");
      console.error(e);
    }
    setBusy(false);
  };

  const enter = async () => {
    const code = join.trim().toUpperCase();
    if (!code) return;
    setBusy(true); setErr("");
    try {
      const d = await fetchGarage(code);
      if (d === null) { setErr("Ese código no existe. Revísalo."); setBusy(false); return; }
      onEnter(code);
    } catch (e) {
      setErr("Error conectando. ¿Config de Supabase correcta?");
      console.error(e);
    }
    setBusy(false);
  };

  return (
    <div className="pl-landing">
      <div className="pl-logo big">PIT<b>LIST</b></div>
      <div className="pl-sub">Listas de piezas compartidas · 3 Stage Garage</div>
      <button className="pl-btn" onClick={create} disabled={busy}>Crear garaje</button>
      <div className="pl-or">— o entra con código —</div>
      <div className="pl-joinrow">
        <input value={join} placeholder="A1B2C3" maxLength={10}
          onChange={(e) => setJoin(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && enter()} />
        <button className="pl-btn" onClick={enter} disabled={busy || !join.trim()}>Entrar</button>
      </div>
      {err && <div className="pl-err">{err}</div>}
    </div>
  );
}

/* ---------- Garaje ---------- */
function Garage({ code, onExit }) {
  const [data, setData] = useState(emptyData);
  const [active, setActive] = useState(null);
  const [me, setMe] = useState(() => localStorage.getItem("pitlist:me") || "");
  const [synced, setSynced] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", price: "", qty: "1" });
  const [showNewProj, setShowNewProj] = useState(false);
  const [projForm, setProjForm] = useState({ name: "", code: "" });
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmPart, setConfirmPart] = useState(null);
  const [filter, setFilter] = useState("todas");
  const [sort, setSort] = useState("recientes");
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", url: "", price: "", qty: "1" });
  const nameRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    setConfirmDel(false); setConfirmPart(null); setEditing(null); setFilter("todas");
  }, [active]);

  // la confirmación de borrado de pieza caduca sola
  useEffect(() => {
    if (!confirmPart) return;
    const t = setTimeout(() => setConfirmPart(null), 3500);
    return () => clearTimeout(t);
  }, [confirmPart]);

  const applyData = useCallback((d) => {
    if (!d) return;
    setData(d);
    setLastSync(new Date());
    if (!activeRef.current && d.projects.length) setActive(d.projects[0].id);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await fetchGarage(code);
      applyData(d);
      setSynced(true);
    } catch (e) { console.error(e); }
  }, [code, applyData]);

  useEffect(() => {
    load();
    const unsub = subscribeGarage(code, applyData); // realtime
    const iv = setInterval(load, 30000);            // red de seguridad si el WS cae
    return () => { unsub(); clearInterval(iv); };
  }, [code, load, applyData]);

  const saveMe = (v) => { setMe(v); localStorage.setItem("pitlist:me", v); };

  const mutate = async (fn) => {
    setSaving(true);
    let next = null;
    try {
      next = await mutateGarage(code, fn);
      applyData(next);
    } catch (e) { console.error("storage error", e); }
    setSaving(false);
    return next;
  };

  const shareLink = window.location.origin + window.location.pathname + "#g=" + code;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard puede fallar sin https */ }
  };

  const addProject = async () => {
    const name = projForm.name.trim();
    if (!name) return;
    const pcode = (projForm.code.trim() || name.slice(0, 4)).toUpperCase();
    const id = uid();
    const next = await mutate((d) => {
      d.projects.push({ id, name, code: pcode });
      d.parts[id] = [];
      return d;
    });
    setProjForm({ name: "", code: "" });
    setShowNewProj(false);
    if (next) setActive(id);
  };

  const delProject = async (id) => {
    const next = await mutate((d) => {
      d.projects = d.projects.filter((p) => p.id !== id);
      delete d.parts[id];
      return d;
    });
    setConfirmDel(false);
    setActive(next?.projects[0]?.id || null);
  };

  const addPart = async () => {
    if (!form.name.trim() || !active) return;
    const part = {
      id: uid(),
      name: form.name.trim(),
      url: form.url.trim() || null,
      price: parseFloat(String(form.price).replace(",", ".")) || 0,
      qty: Math.max(1, parseInt(form.qty) || 1),
      status: "pendiente",
      by: me || "?",
      ts: Date.now(),
    };
    await mutate((d) => {
      if (!d.parts[active]) d.parts[active] = [];
      d.parts[active].unshift(part);
      return d;
    });
    setForm({ name: "", url: "", price: "", qty: "1" });
    nameRef.current?.focus();
  };

  const bumpQty = (delta) =>
    setForm((f) => ({ ...f, qty: String(Math.max(1, (parseInt(f.qty) || 1) + delta)) }));

  const setStatus = (pid, partId, status) =>
    mutate((d) => {
      const p = (d.parts[pid] || []).find((x) => x.id === partId);
      if (p && !p.trolled) p.status = status;
      return d;
    });

  const startEdit = (p) => {
    setConfirmPart(null);
    setEditing(p.id);
    setEditForm({ name: p.name, url: p.url || "", price: p.price ? String(p.price) : "", qty: String(p.qty || 1) });
  };

  const saveEdit = async () => {
    const name = editForm.name.trim();
    if (!name || !editing) return;
    const patch = {
      name,
      url: editForm.url.trim() || null,
      price: parseFloat(String(editForm.price).replace(",", ".")) || 0,
      qty: Math.max(1, parseInt(editForm.qty) || 1),
    };
    await mutate((d) => {
      const p = (d.parts[active] || []).find((x) => x.id === editing);
      if (p) Object.assign(p, patch);
      return d;
    });
    setEditing(null);
  };

  const onEditKey = (e) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") setEditing(null);
  };

  const askDelPart = (partId) => {
    if (confirmPart === partId) { setConfirmPart(null); delPart(active, partId); }
    else setConfirmPart(partId);
  };

  const toggleTroll = (pid, partId) =>
    mutate((d) => {
      const p = (d.parts[pid] || []).find((x) => x.id === partId);
      if (p) { p.trolled = !p.trolled; if (p.trolled) p.trolledBy = me || "?"; }
      return d;
    });

  const delPart = (pid, partId) =>
    mutate((d) => { d.parts[pid] = (d.parts[pid] || []).filter((x) => x.id !== partId); return d; });

  const proj = data.projects.find((p) => p.id === active);
  const allParts = (active && data.parts[active]) || [];
  const parts = allParts.filter((p) => !p.trolled);
  const trolled = allParts.filter((p) => p.trolled);
  const porGastar = parts.filter((p) => p.status !== "recibido").reduce((s, p) => s + p.price * p.qty, 0);
  const gastado = parts.filter((p) => p.status === "recibido").reduce((s, p) => s + p.price * p.qty, 0);
  const total = porGastar + gastado;
  const pct = total > 0 ? Math.round((gastado / total) * 100) : 0;
  const counts = { todas: parts.length };
  for (const s of STATUSES) counts[s] = parts.filter((p) => p.status === s).length;
  const shown = parts
    .filter((p) => filter === "todas" || p.status === filter)
    .sort((a, b) =>
      sort === "precio" ? b.price * b.qty - a.price * a.qty
      : sort === "estado" ? (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) || ((b.ts || 0) - (a.ts || 0))
      : (b.ts || 0) - (a.ts || 0));

  return (
    <div className="pl-wrap">
      <div className="pl-header">
        <div className="pl-logo" onClick={onExit} style={{ cursor: "pointer" }} title="Salir al inicio">
          PIT<b>LIST</b>
        </div>
        <div className="pl-sync">
          <span className={"pl-dot" + (synced && !saving ? "" : " off")} />
          {saving ? "guardando…" : lastSync
            ? "sync " + lastSync.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : "conectando…"}
        </div>
      </div>

      <div className="pl-roomrow">
        <span className="pl-roomcode" title="Código del garaje">🔧 {code}</span>
        <button className="pl-mini" onClick={copyLink}>{copied ? "¡copiado!" : "copiar link"}</button>
        <span className="pl-mespace" />
        <label className="pl-melbl">Tú eres</label>
        <input className="pl-meinput" value={me} placeholder="Alex / …" maxLength={16}
          onChange={(e) => saveMe(e.target.value)} />
      </div>

      <div className="pl-tabs">
        {data.projects.map((p) => (
          <div key={p.id} className={"pl-plate" + (p.id === active ? " active" : "")}
            onClick={() => setActive(p.id)} role="button" aria-label={"Proyecto " + p.name}>
            <div className="code">{p.code}</div>
            <div className="nm">{p.name}</div>
          </div>
        ))}
        <div className="pl-plate add" onClick={() => setShowNewProj(!showNewProj)} role="button"
          aria-label="Nuevo proyecto">{showNewProj ? "cancelar" : "+ proyecto"}</div>
      </div>

      {showNewProj && (
        <div className="pl-form" style={{ marginTop: 4 }}>
          <div className="row">
            <input className="grow" autoFocus placeholder="Nombre (ej: Nissan 200SX)" value={projForm.name}
              onChange={(e) => setProjForm({ ...projForm, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addProject()} />
            <input className="sm" placeholder="Código (S13)" maxLength={6} value={projForm.code}
              onChange={(e) => setProjForm({ ...projForm, code: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addProject()} />
            <button className="pl-btn" onClick={addProject} disabled={!projForm.name.trim()}>Crear</button>
          </div>
        </div>
      )}

      {proj ? (
        <>
          <div className="pl-totals">
            <div><div className="lbl">Piezas</div><div className="val">{parts.length}</div></div>
            <div><div className="lbl">Por gastar</div><div className="val red">{eur(porGastar)}</div></div>
            <div><div className="lbl">Gastado</div><div className="val grn">{eur(gastado)}</div></div>
          </div>

          {total > 0 && (
            <div className="pl-progressrow" title={pct + "% del presupuesto ya gastado"}>
              <div className="pl-progress"><i style={{ width: pct + "%" }} /></div>
              <span className="pl-pct">{pct}% comprado</span>
            </div>
          )}

          <div className="pl-form">
            <div className="row">
              <input className="grow" ref={nameRef} placeholder="Pieza (ej: CP Pistons SC7345)" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPart()} />
            </div>
            <div className="row">
              <input className="grow" placeholder="Link tienda (opcional)" value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPart()} />
              <input className="sm" placeholder="Precio €" inputMode="decimal" value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPart()} />
              <div className="pl-qtybox">
                <button type="button" aria-label="Menos unidades" onClick={() => bumpQty(-1)}>−</button>
                <input placeholder="Uds" inputMode="numeric" value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addPart()} />
                <button type="button" aria-label="Más unidades" onClick={() => bumpQty(1)}>+</button>
              </div>
              <button className="pl-btn" onClick={addPart} disabled={!form.name.trim()}>Añadir</button>
            </div>
          </div>

          {allParts.length === 0 && <div className="pl-empty">Sin piezas todavía. Añade la primera arriba.</div>}

          {parts.length > 0 && (
            <div className="pl-listbar">
              {["todas", ...STATUSES].map((f) => (
                <button key={f} className={"pl-chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
                  {f}<span className="n">{counts[f]}</span>
                </button>
              ))}
              <select className="pl-sort" value={sort} onChange={(e) => setSort(e.target.value)}
                aria-label="Ordenar piezas">
                <option value="recientes">recientes</option>
                <option value="precio">precio ↓</option>
                <option value="estado">estado</option>
              </select>
            </div>
          )}

          {parts.length > 0 && shown.length === 0 && <div className="pl-empty">Nada con este filtro.</div>}

          {shown.map((p) => editing === p.id ? (
            <div key={p.id} className="pl-part editing">
              <div className="pl-edit">
                <div className="row">
                  <input className="grow" autoFocus placeholder="Pieza" value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} onKeyDown={onEditKey} />
                </div>
                <div className="row">
                  <input className="grow" placeholder="Link tienda (opcional)" value={editForm.url}
                    onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} onKeyDown={onEditKey} />
                  <input className="sm" placeholder="Precio €" inputMode="decimal" value={editForm.price}
                    onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} onKeyDown={onEditKey} />
                  <input className="xs" placeholder="Uds" inputMode="numeric" value={editForm.qty}
                    onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })} onKeyDown={onEditKey} />
                </div>
                <div className="row">
                  <button className="pl-btn small" onClick={saveEdit} disabled={!editForm.name.trim()}>Guardar</button>
                  <button className="pl-mini" onClick={() => setEditing(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          ) : (
            <div key={p.id} className={"pl-part " + p.status}>
              <div className="info">
                <div className="nm">
                  {p.url
                    ? <a href={p.url} target="_blank" rel="noopener noreferrer nofollow ugc">{p.name}</a>
                    : p.name}
                </div>
                <div className="meta">
                  {p.url && domain(p.url) && <span>{domain(p.url)}</span>}
                  <span>por {p.by}</span>
                  <span>{new Date(p.ts).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })}</span>
                </div>
                <div className="pl-seg" role="group" aria-label="Estado de la pieza">
                  {STATUSES.map((s) => (
                    <button key={s} className={"seg " + s + (p.status === s ? " on" : "")}
                      onClick={() => p.status !== s && setStatus(active, p.id, s)}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="side">
                <div className="price">{eur(p.price * p.qty)}</div>
                {p.qty > 1 && <div className="qty">{p.qty} × {eur(p.price)}</div>}
              </div>
              <div className="acts">
                <button className="pl-ico" onClick={() => startEdit(p)} aria-label="Editar pieza" title="Editar">✎</button>
                <button className="pl-troll" onClick={() => toggleTroll(active, p.id)}
                  aria-label="Marcar como troleada" title="A la zona de troleo">🤡</button>
                <button className={"pl-x" + (confirmPart === p.id ? " arm" : "")}
                  onClick={() => askDelPart(p.id)} aria-label="Borrar pieza">
                  {confirmPart === p.id ? "¿seguro?" : "✕"}
                </button>
              </div>
            </div>
          ))}

          {trolled.length > 0 && (
            <>
              <div className="pl-trollhead">🤡 Zona de troleo · {trolled.length}</div>
              {trolled.map((p) => (
                <div key={p.id} className="pl-part trolled">
                  <div className="pl-stamp">TROLEADA</div>
                  <div className="info">
                    <div className="nm">
                      {p.url
                        ? <a href={p.url} target="_blank" rel="noopener noreferrer nofollow ugc">{p.name}</a>
                        : p.name}
                    </div>
                    <div className="meta">
                      <span>metida por {p.by}</span>
                      <span>cazada por {p.trolledBy || "?"}</span>
                    </div>
                  </div>
                  <div className="side"><div className="price">{eur(p.price * p.qty)}</div></div>
                  <div className="acts">
                    <button className="pl-troll on" onClick={() => toggleTroll(active, p.id)}
                      aria-label="Perdonar y devolver a la lista" title="Perdonar">🤡</button>
                    <button className={"pl-x" + (confirmPart === p.id ? " arm" : "")}
                      onClick={() => askDelPart(p.id)} aria-label="Borrar pieza">
                      {confirmPart === p.id ? "¿seguro?" : "✕"}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {confirmDel ? (
            <span style={{ display: "inline-flex", gap: 8, marginTop: 18 }}>
              <button className="pl-danger" style={{ marginTop: 0, borderColor: "var(--accent)", color: "var(--accent)" }}
                onClick={() => delProject(active)}>Sí, borrar todo</button>
              <button className="pl-danger" style={{ marginTop: 0 }}
                onClick={() => setConfirmDel(false)}>Cancelar</button>
            </span>
          ) : (
            <button className="pl-danger" onClick={() => setConfirmDel(true)}>Borrar proyecto</button>
          )}
        </>
      ) : (
        <div className="pl-empty">Crea el primer proyecto con “+ proyecto” — S13, GSX, lo que toque.</div>
      )}
    </div>
  );
}

/* ---------- Router mínimo por hash ---------- */
export default function App() {
  const [code, setCode] = useState(() => codeFromHash() || localStorage.getItem("pitlist:last") || null);

  useEffect(() => {
    const onHash = () => setCode(codeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const enter = (c) => {
    localStorage.setItem("pitlist:last", c);
    window.location.hash = "g=" + c;
    setCode(c);
  };
  const exit = () => {
    localStorage.removeItem("pitlist:last");
    history.replaceState(null, "", window.location.pathname);
    setCode(null);
  };

  return (
    <div className="pl-root">
      {code ? <Garage code={code} onExit={exit} /> : <Landing onEnter={enter} />}
    </div>
  );
}
