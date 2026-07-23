import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  clientId, fetchMessages, postMessage, deleteMessage, subscribeMessages,
} from "./storage.js";

/* Estado de mensajes de UN garaje: chat de sala y comentarios de piezas.
   Vive una sola vez en <Garage> — una carga, una suscripción, una verdad.
   Los hilos de comentarios se sirven de aquí filtrando; no se suscriben por su cuenta. */

// Los confirmados van por seq; los que aún están en vuelo, al final por hora local.
const byOrder = (a, b) => {
  if (a.seq != null && b.seq != null) return a.seq - b.seq;
  if (a.seq != null) return -1;
  if (b.seq != null) return 1;
  return a.created_at < b.created_at ? -1 : 1;
};

const seenKey = (code) => "pitlist:seen:" + code;

export function useMessages(code, me) {
  const [msgs, setMsgs] = useState(() => new Map());
  const [people, setPeople] = useState([]);
  const [seen, setSeen] = useState(0);
  const liveRef = useRef(null);
  const cid = clientId();

  const upsert = useCallback((...rows) => setMsgs((prev) => {
    const next = new Map(prev);
    for (const r of rows) next.set(r.id, { ...next.get(r.id), ...r });
    return next;
  }), []);

  const drop = useCallback((id) => setMsgs((prev) => {
    if (!prev.has(id)) return prev;          // ids de otras salas: se ignoran
    const next = new Map(prev);
    next.delete(id);
    return next;
  }), []);

  const load = useCallback(async () => {
    try { upsert(...(await fetchMessages(code))); }
    catch (e) { console.error("messages load", e); }
  }, [code, upsert]);

  useEffect(() => {
    setMsgs(new Map());
    setPeople([]);
    setSeen(Number(localStorage.getItem(seenKey(code)) || 0));
    load();
    const live = subscribeMessages(code, {
      onInsert: (row) => upsert(row),
      onDelete: drop,
      onPresence: setPeople,
      name: me,
    });
    liveRef.current = live;
    const iv = setInterval(load, 30000);     // misma red de seguridad que el blob
    return () => { live.stop(); clearInterval(iv); liveRef.current = null; };
    // `me` fuera de las dependencias a propósito: renombrarse no debe reabrir el canal.
  }, [code, load, upsert, drop]);

  // El input del rail escribe en cada tecla y cada re-anuncio deja una entrada más
  // en la presencia de todos: se espera a que pares de escribir.
  useEffect(() => {
    const t = setTimeout(() => liveRef.current?.setName(me), 400);
    return () => clearTimeout(t);
  }, [me]);

  // Enviar y reintentar comparten camino: el id ya está puesto, así que repetir es inofensivo.
  const push = useCallback(async (row) => {
    upsert({ ...row, pending: true, failed: false });
    try {
      const saved = await postMessage({
        id: row.id, garage_code: row.garage_code, kind: row.kind,
        part_id: row.part_id, project_id: row.project_id,
        author: row.author, client_id: row.client_id, body: row.body,
      });
      upsert({ ...(saved || {}), id: row.id, pending: false, failed: false });
    } catch (e) {
      console.error("message send", e);
      upsert({ id: row.id, pending: false, failed: true });
    }
  }, [upsert]);

  const send = useCallback((body, { partId = null, projectId = null } = {}) => {
    const text = body.trim();
    if (!text || !me.trim()) return;
    return push({
      id: crypto.randomUUID(),
      garage_code: code,
      kind: partId ? "comment" : "chat",
      part_id: partId, project_id: projectId,
      author: me.trim().slice(0, 16), client_id: cid,
      body: text.slice(0, 1000),
      created_at: new Date().toISOString(),
    });
  }, [code, me, cid, push]);

  const resend = useCallback((id) => {
    const m = msgs.get(id);
    if (m) push(m);
  }, [msgs, push]);

  const remove = useCallback(async (id) => {
    const prev = msgs.get(id);
    drop(id);
    try { await deleteMessage(id); }
    catch (e) { console.error("message delete", e); if (prev) upsert(prev); }
  }, [msgs, drop, upsert]);

  const all = useMemo(() => [...msgs.values()].sort(byOrder), [msgs]);
  const chat = useMemo(() => all.filter((m) => m.kind === "chat"), [all]);

  // { [partId]: mensajes } — cada hilo lee de aquí, sin consultas propias.
  const comments = useMemo(() => {
    const by = {};
    for (const m of all) if (m.kind === "comment") (by[m.part_id] ||= []).push(m);
    return by;
  }, [all]);

  const unread = useMemo(
    () => chat.filter((m) => (m.seq ?? 0) > seen && m.client_id !== cid).length,
    [chat, seen, cid]
  );

  const markRead = useCallback(() => {
    const top = chat.reduce((max, m) => Math.max(max, m.seq ?? 0), 0);
    if (!top) return;
    localStorage.setItem(seenKey(code), String(top));
    setSeen(top);
  }, [chat, code]);

  return { chat, comments, people, unread, markRead, send, resend, remove, cid };
}
