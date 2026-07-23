import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const emptyData = { projects: [], parts: {}, updatedAt: 0 };

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I/L
export function newCode() {
  let c = "";
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  for (let i = 0; i < 6; i++) c += CODE_CHARS[a[i] % CODE_CHARS.length];
  return c;
}

export async function createGarage() {
  const code = newCode();
  const { error } = await supabase.from("garages").insert({ code, data: emptyData });
  if (error) throw error;
  return code;
}

export async function fetchGarage(code) {
  const { data, error } = await supabase
    .from("garages").select("data").eq("code", code).maybeSingle();
  if (error) throw error;
  return data ? data.data : null; // null = código no existe
}

// read-latest -> apply -> write, minimiza pisadas entre usuarios
export async function mutateGarage(code, fn) {
  const current = (await fetchGarage(code)) ?? structuredClone(emptyData);
  const next = fn(structuredClone(current));
  next.updatedAt = Date.now();
  const { error } = await supabase
    .from("garages")
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq("code", code);
  if (error) throw error;
  return next;
}

/* ================= mensajes: chat de sala y comentarios de pieza =================
   Viven en su propia tabla, NO en el blob del garaje: el blob se reescribe entero
   en cada mutación (last-write-wins), y un chat lo convertiría en pérdida de datos.
   Ver HANDOFF.md. */

const CID_KEY = "pitlist:cid";
// Identificador opaco de navegador. Sirve para "mis mensajes" y para la presencia.
export function clientId() {
  let c = localStorage.getItem(CID_KEY);
  if (!c) { c = crypto.randomUUID(); localStorage.setItem(CID_KEY, c); }
  return c;
}

export const CHAT_PAGE = 200;

// Devuelve chat (últimos CHAT_PAGE) + todos los comentarios, en una sola lista plana.
export async function fetchMessages(code, { chatLimit = CHAT_PAGE } = {}) {
  const [chat, comments] = await Promise.all([
    supabase.from("garage_messages").select("*")
      .eq("garage_code", code).eq("kind", "chat")
      .order("seq", { ascending: false }).limit(chatLimit),
    supabase.from("garage_messages").select("*")
      .eq("garage_code", code).eq("kind", "comment")
      .order("seq", { ascending: true }),
  ]);
  if (chat.error) throw chat.error;
  if (comments.error) throw comments.error;
  return [...chat.data, ...comments.data];
}

// El id lo pone el cliente: reenviar el mismo mensaje es un no-op, no un duplicado.
// Si ya existía, Supabase no devuelve fila — de ahí el null.
export async function postMessage(row) {
  const { data, error } = await supabase
    .from("garage_messages")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true })
    .select().maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function deleteMessage(id) {
  const { error } = await supabase.from("garage_messages").delete().eq("id", id);
  if (error) throw error;
}

// Al borrar una pieza o un build, sus comentarios quedarían huérfanos invisibles.
export async function deleteMessagesForPart(partId) {
  const { error } = await supabase.from("garage_messages").delete().eq("part_id", partId);
  if (error) throw error;
}
export async function deleteMessagesForProject(projectId) {
  const { error } = await supabase.from("garage_messages").delete().eq("project_id", projectId);
  if (error) throw error;
}

// Re-anunciarse AÑADE una entrada a la lista del cliente en vez de reemplazarla,
// así que el nombre bueno es el último, no el primero.
const peopleIn = (ch) =>
  Object.entries(ch.presenceState())
    .map(([cid, metas]) => ({ clientId: cid, name: metas[metas.length - 1]?.name || "" }));

// Un canal por garaje: INSERT + DELETE de mensajes y presencia de quien está dentro.
export function subscribeMessages(code, { onInsert, onDelete, onPresence, name }) {
  const cid = clientId();
  const ch = supabase
    .channel("live-" + code, { config: { presence: { key: cid } } })
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "garage_messages", filter: `garage_code=eq.${code}` },
      (p) => onInsert?.(p.new))
    // OJO: el payload de DELETE solo trae la PK (replica identity por defecto), así que
    // NO se puede filtrar por garage_code — llegan los de todas las salas. El cliente
    // ignora los ids que no conoce.
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "garage_messages" },
      (p) => onDelete?.(p.old.id))
    // sync no basta: cuando alguien YA presente se renombra, Supabase emite join,
    // y quien estuviera mirando se quedaría con el nombre viejo (o con "anónimo").
    .on("presence", { event: "sync" }, () => onPresence?.(peopleIn(ch)))
    .on("presence", { event: "join" }, () => onPresence?.(peopleIn(ch)))
    .on("presence", { event: "leave" }, () => onPresence?.(peopleIn(ch)))
    .subscribe((status) => { if (status === "SUBSCRIBED") ch.track({ name }); });

  return {
    // Renombrarse re-anuncia la presencia sin reabrir el canal.
    setName: (n) => ch.track({ name: n }),
    stop: () => supabase.removeChannel(ch),
  };
}

// Suscripción realtime a los cambios de un garaje concreto
export function subscribeGarage(code, onData) {
  const ch = supabase
    .channel("garage-" + code)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "garages", filter: `code=eq.${code}` },
      (payload) => onData(payload.new.data)
    )
    .subscribe();
  return () => supabase.removeChannel(ch);
}
