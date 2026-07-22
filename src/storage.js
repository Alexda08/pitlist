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
