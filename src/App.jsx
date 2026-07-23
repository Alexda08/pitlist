import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import {
  emptyData, createGarage, fetchGarage, mutateGarage, subscribeGarage,
  deleteMessagesForPart, deleteMessagesForProject,
} from "./storage.js";
import { useMessages } from "./useMessages.js";
import { MessageList, Composer } from "./Messages.jsx";
import { Chat, Presence } from "./Chat.jsx";

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const STATUSES = ["pendiente", "pedido", "recibido"];
const nextStatus = (s) => STATUSES[(STATUSES.indexOf(s) + 1) % STATUSES.length];

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

// Stage según % de piezas recibidas: 0–33 → 1, 33–66 → 2, 66–100 → 3
const stageOf = (pct) => (pct >= 200 / 3 ? 3 : pct >= 100 / 3 ? 2 : 1);

function Leds({ lit }) {
  return (
    <span className="lights">
      {[1, 2, 3].map((n) => <span key={n} className={"led" + (lit >= n ? " on" + n : "")} />)}
    </span>
  );
}

function Brand() {
  return (
    <>
      <Leds lit={3} />
      <div className="t">PitList<small>3 STAGE GARAGE</small></div>
    </>
  );
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
    <div className="landing">
      <div className="brand big"><Brand /></div>
      <button className="btn" onClick={create} disabled={busy}>Crear garaje</button>
      <div className="or">— o entra con código —</div>
      <div className="joinrow">
        <input value={join} placeholder="A1B2C3" maxLength={10}
          onChange={(e) => setJoin(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && enter()} />
        <button className="btn" onClick={enter} disabled={busy || !join.trim()}>Entrar</button>
      </div>
      {err && <div className="err">{err}</div>}
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
  const [showSheet, setShowSheet] = useState(false);
  const [thread, setThread] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  // chat de sala y comentarios: una sola carga y una sola suscripción para todo el garaje
  const M = useMessages(code, me);

  useEffect(() => {
    setConfirmDel(false); setConfirmPart(null); setEditing(null); setFilter("todas");
    setShowSheet(false); setThread(null);
  }, [active]);

  // la confirmación de borrado de pieza caduca sola
  useEffect(() => {
    if (!confirmPart) return;
    const t = setTimeout(() => setConfirmPart(null), 3500);
    return () => clearTimeout(t);
  }, [confirmPart]);

  // Esc cierra la hoja de añadir pieza
  useEffect(() => {
    if (!showSheet) return;
    const onKey = (e) => { if (e.key === "Escape") setShowSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSheet]);

  // Esc cierra el chat (nunca están los dos abiertos: abrir uno cierra el otro)
  useEffect(() => {
    if (!showChat) return;
    const onKey = (e) => { if (e.key === "Escape") setShowChat(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showChat]);

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
    // sin esto, sus comentarios quedan huérfanos e invisibles en la tabla
    deleteMessagesForProject(id).catch((e) => console.error("comentarios del build", e));
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
    setShowSheet(false);
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

  const delPart = (pid, partId) => {
    deleteMessagesForPart(partId).catch((e) => console.error("comentarios de la pieza", e));
    return mutate((d) => { d.parts[pid] = (d.parts[pid] || []).filter((x) => x.id !== partId); return d; });
  };

  const proj = data.projects.find((p) => p.id === active);
  const allParts = (active && data.parts[active]) || [];
  const parts = allParts.filter((p) => !p.trolled);
  const trolled = allParts.filter((p) => p.trolled);
  const porGastar = parts.filter((p) => p.status !== "recibido").reduce((s, p) => s + p.price * p.qty, 0);
  const gastado = parts.filter((p) => p.status === "recibido").reduce((s, p) => s + p.price * p.qty, 0);
  const recibidas = parts.filter((p) => p.status === "recibido").length;
  const stagePct = parts.length ? Math.round((recibidas / parts.length) * 100) : 0;
  const stage = stageOf(stagePct);
  const segFill = (i) => Math.max(0, Math.min(1, (stagePct - i * (100 / 3)) / (100 / 3)));
  const stageForProject = (pid) => {
    const ps = (data.parts[pid] || []).filter((x) => !x.trolled);
    if (!ps.length) return 1;
    return stageOf((ps.filter((x) => x.status === "recibido").length / ps.length) * 100);
  };
  const counts = { todas: parts.length };
  for (const s of STATUSES) counts[s] = parts.filter((p) => p.status === s).length;
  const shown = parts
    .filter((p) => filter === "todas" || p.status === filter)
    .sort((a, b) =>
      sort === "precio" ? b.price * b.qty - a.price * a.qty
      : sort === "estado" ? (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) || ((b.ts || 0) - (a.ts || 0))
      : (b.ts || 0) - (a.ts || 0));

  return (
    <>
      <div className="top">
        <div className="brand" onClick={onExit} role="button" title="Salir al inicio"><Brand /></div>
        <span className="sp" />
        <button className="chip" onClick={copyLink} title="Copiar link de invitación">
          🔧 <b>{code}</b> · {copied ? "¡copiado!" : "copiar"}
        </button>
        <button className={"chip" + (M.unread ? " alert" : "")} title="Chat del garaje"
          onClick={() => { setShowSheet(false); setShowChat(true); }}>
          💬 chat{M.unread > 0 && <b> {M.unread}</b>}
        </button>
        <Presence people={M.people} cid={M.cid} />
        <span className="sync">
          <span className={"dot" + (synced && !saving ? "" : " off")} />
          <span className="txt">
            {saving ? "guardando…" : lastSync
              ? "sync " + lastSync.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
              : "conectando…"}
          </span>
        </span>
      </div>

      <div className="shell">
        <aside className="rail">
          <div className="railhead">
            <h4>Garaje · {data.projects.length} {data.projects.length === 1 ? "build" : "builds"}</h4>
            <div className="me">
              <label htmlFor="me-input">Tú eres</label>
              <input id="me-input" value={me} placeholder="Alex / …" maxLength={16}
                onChange={(e) => saveMe(e.target.value)} />
            </div>
          </div>
          <div className="plates">
            {data.projects.map((p) => {
              const st = stageForProject(p.id);
              return (
                <div key={p.id} className={"plate stage" + st + (p.id === active ? " active" : "")}
                  onClick={() => setActive(p.id)} role="button" aria-label={"Build " + p.name}>
                  <div className="row1">
                    <span className="code">{p.code}</span>
                    <Leds lit={st} />
                  </div>
                  <div className="nm">{p.name}</div>
                </div>
              );
            })}
            <div className="plate add" onClick={() => setShowNewProj(!showNewProj)} role="button"
              aria-label="Nuevo build">{showNewProj ? "cancelar" : "+ nuevo build"}</div>
          </div>
          {showNewProj && (
            <div className="projform">
              <input autoFocus placeholder="Nombre (ej: Nissan 200SX)" value={projForm.name}
                onChange={(e) => setProjForm({ ...projForm, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addProject()} />
              <input placeholder="Código (S13)" maxLength={6} value={projForm.code}
                onChange={(e) => setProjForm({ ...projForm, code: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addProject()} />
              <button className="btn small" onClick={addProject} disabled={!projForm.name.trim()}>Crear</button>
            </div>
          )}
        </aside>

        <main className="main">
          {proj ? (
            <>
              <div className="build">
                <div className="watermark">{proj.code}</div>
                <h1>{proj.name}</h1>
                <div className="gauge">
                  <span className="stg" style={{ color: `var(--s${stage})` }}>Stage {stage}</span>
                  <div className="bar">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className={"seg f" + (i + 1)}>
                        <i style={{ transform: `scaleX(${segFill(i)})` }} />
                      </div>
                    ))}
                  </div>
                  <span className="pct">{stagePct}% recibido</span>
                </div>
                <div className="readout">
                  <div className="r"><div className="l">Piezas</div><div className="v">{recibidas}<small>/{parts.length}</small></div></div>
                  <div className="r"><div className="l">Por gastar</div><div className="v hot">{eur(porGastar)}</div></div>
                  <div className="r"><div className="l">Gastado</div><div className="v ok">{eur(gastado)}</div></div>
                  <div className="r"><div className="l">Troleadas</div><div className="v trl">{trolled.length}</div></div>
                </div>
              </div>

              <div className="sect">Lista de piezas</div>

              {parts.length > 0 && (
                <div className="listbar">
                  {["todas", ...STATUSES].map((f) => (
                    <button key={f} className={"fchip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
                      {f}<span className="n">{counts[f]}</span>
                    </button>
                  ))}
                  <select className="sort" value={sort} onChange={(e) => setSort(e.target.value)}
                    aria-label="Ordenar piezas">
                    <option value="recientes">recientes</option>
                    <option value="precio">precio ↓</option>
                    <option value="estado">estado</option>
                  </select>
                </div>
              )}

              {allParts.length === 0 && <div className="empty">Sin piezas todavía. Dale a “+ Pieza”.</div>}
              {parts.length > 0 && shown.length === 0 && <div className="empty">Nada con este filtro.</div>}

              {shown.map((p) => editing === p.id ? (
                <div key={p.id} className="part editing">
                  <div className="editform">
                    <div className="frow">
                      <input className="grow" autoFocus placeholder="Pieza" value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} onKeyDown={onEditKey} />
                    </div>
                    <div className="frow">
                      <input className="grow" placeholder="Link tienda (opcional)" value={editForm.url}
                        onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} onKeyDown={onEditKey} />
                      <input className="smf" placeholder="Precio €" inputMode="decimal" value={editForm.price}
                        onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} onKeyDown={onEditKey} />
                      <input className="xsf" placeholder="Uds" inputMode="numeric" value={editForm.qty}
                        onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })} onKeyDown={onEditKey} />
                    </div>
                    <div className="frow">
                      <button className="btn small" onClick={saveEdit} disabled={!editForm.name.trim()}>Guardar</button>
                      <button className="ghost" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </div>
                </div>
              ) : (
                <Fragment key={p.id}>
                <div className={"part " + p.status}>
                  <button className="stledbtn" onClick={() => setStatus(active, p.id, nextStatus(p.status))}
                    title={"Estado: " + p.status + " · click → " + nextStatus(p.status)}
                    aria-label={"Estado: " + p.status + ". Cambiar a " + nextStatus(p.status)}>
                    <span className={"stled " + p.status} />
                  </button>
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
                  </div>
                  <div className="money">
                    <div className="price">{eur(p.price * p.qty)}</div>
                    {p.qty > 1 && <div className="qty">{p.qty} × {eur(p.price)}</div>}
                  </div>
                  <div className="acts">
                    <button className={"ib chat" + (thread === p.id ? " on" : "")}
                      onClick={() => setThread(thread === p.id ? null : p.id)}
                      aria-label={`Comentarios de ${p.name} (${M.comments[p.id]?.length || 0})`}
                      title="Comentarios">
                      💬{(M.comments[p.id]?.length || 0) > 0 && <span className="n">{M.comments[p.id].length}</span>}
                    </button>
                    <button className="ib" onClick={() => startEdit(p)} aria-label="Editar pieza" title="Editar">✎</button>
                    <button className="ib clown" onClick={() => toggleTroll(active, p.id)}
                      aria-label="Marcar como troleada" title="A la zona de troleo">🤡</button>
                    <button className={"ib x" + (confirmPart === p.id ? " arm" : "")}
                      onClick={() => askDelPart(p.id)} aria-label="Borrar pieza">
                      {confirmPart === p.id ? "¿seguro?" : "✕"}
                    </button>
                  </div>
                </div>
                {thread === p.id && (
                  <div className="thread">
                    <MessageList items={M.comments[p.id] || []} cid={M.cid}
                      onDelete={M.remove} onResend={M.resend}
                      empty="Sin comentarios todavía." />
                    <Composer me={me} onName={saveMe} autoFocus
                      placeholder="Comentar esta pieza…"
                      onSend={(t) => M.send(t, { partId: p.id, projectId: active })} />
                  </div>
                )}
                </Fragment>
              ))}

              {trolled.length > 0 && (
                <>
                  <div className="sect trollhead">🤡 Zona de troleo · {trolled.length}</div>
                  {trolled.map((p) => (
                    <div key={p.id} className="part trolled">
                      <span className="stled pendiente" />
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
                      <div className="money"><div className="price">{eur(p.price * p.qty)}</div></div>
                      <div className="acts">
                        <button className="ib clown on" onClick={() => toggleTroll(active, p.id)}
                          aria-label="Perdonar y devolver a la lista" title="Perdonar">🤡</button>
                        <button className={"ib x" + (confirmPart === p.id ? " arm" : "")}
                          onClick={() => askDelPart(p.id)} aria-label="Borrar pieza">
                          {confirmPart === p.id ? "¿seguro?" : "✕"}
                        </button>
                      </div>
                      <div className="stamp">Troleada</div>
                    </div>
                  ))}
                </>
              )}

              {confirmDel ? (
                <span className="dangerrow">
                  <button className="danger arm" onClick={() => delProject(active)}>Sí, borrar todo</button>
                  <button className="danger" onClick={() => setConfirmDel(false)}>Cancelar</button>
                </span>
              ) : (
                <button className="danger" onClick={() => setConfirmDel(true)}>Borrar build</button>
              )}
            </>
          ) : (
            <div className="empty">Crea el primer build con “+ nuevo build” — S13, GSX, lo que toque.</div>
          )}
        </main>
      </div>

      {proj && !showSheet && !showChat && (
        <button className="fab" onClick={() => { setShowChat(false); setShowSheet(true); }}>+ Pieza</button>
      )}
      {proj && showSheet && (
        <>
          <div className="sheetbg" onClick={() => setShowSheet(false)} />
          <div className="sheet" role="dialog" aria-label="Añadir pieza">
            <h3>Añadir pieza · {proj.code}</h3>
            <div className="frow">
              <input className="grow" autoFocus placeholder="Pieza (ej: CP Pistons SC7345)" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPart()} />
            </div>
            <div className="frow">
              <input className="grow" placeholder="Link tienda (opcional)" value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPart()} />
              <input className="smf" placeholder="Precio €" inputMode="decimal" value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && addPart()} />
              <div className="qtybox">
                <button type="button" aria-label="Menos unidades" onClick={() => bumpQty(-1)}>−</button>
                <input placeholder="Uds" inputMode="numeric" value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addPart()} />
                <button type="button" aria-label="Más unidades" onClick={() => bumpQty(1)}>+</button>
              </div>
              <button className="btn" onClick={addPart} disabled={!form.name.trim()}>Añadir</button>
            </div>
          </div>
        </>
      )}

      {/* el chat es de la sala: funciona aunque no haya ningún build creado */}
      {showChat && <Chat M={M} me={me} onName={saveMe} onClose={() => setShowChat(false)} />}
    </>
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
    <div className="root">
      {code ? <Garage code={code} onExit={exit} /> : <Landing onEnter={enter} />}
    </div>
  );
}
