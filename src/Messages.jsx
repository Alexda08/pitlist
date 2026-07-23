import { useState, useEffect } from "react";

/* Piezas compartidas por el chat de sala y los hilos de comentarios.
   No saben nada de Supabase: todo les llega por props desde useMessages. */

const hhmm = (iso) =>
  new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

const URL_RE = /(https?:\/\/[^\s]+)/g;

// Los enlaces que pega la gente son contenido de usuario: mismo rel que en las piezas.
function Body({ text }) {
  return text.split(URL_RE).map((chunk, i) =>
    i % 2 === 1
      ? <a key={i} href={chunk} target="_blank" rel="noopener noreferrer nofollow ugc">{chunk}</a>
      : <span key={i}>{chunk}</span>
  );
}

/* Compositor. Si aún no tienes nombre, primero lo pide: nunca prompt(). */
export function Composer({ me, onName, onSend, placeholder = "Escribe…", autoFocus = false }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  if (!me.trim()) {
    const save = () => name.trim() && onName(name.trim());
    return (
      <div className="composer">
        <input autoFocus={autoFocus} maxLength={16} value={name} placeholder="¿Cómo te llamas?"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()} />
        <button className="btn small" disabled={!name.trim()} onClick={save}>Entrar</button>
      </div>
    );
  }

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="composer">
      <input autoFocus={autoFocus} maxLength={1000} value={text} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn small" disabled={!text.trim()} onClick={submit}>Enviar</button>
    </div>
  );
}

export function MessageList({ items, cid, onDelete, onResend, empty, className = "" }) {
  const [armed, setArmed] = useState(null);

  // la confirmación de borrado caduca sola, igual que en las piezas
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  if (!items.length) return <div className="msgempty">{empty}</div>;

  const ask = (id) => {
    if (armed === id) { setArmed(null); onDelete(id); }
    else setArmed(id);
  };

  return (
    <div className={"msgs " + className} role="log" aria-live="polite">
      {items.map((m) => (
        <div key={m.id}
          className={"msg" + (m.client_id === cid ? " mine" : "") +
            (m.pending ? " pending" : "") + (m.failed ? " failed" : "")}>
          <div className="who">
            <b>{m.author}</b>
            <time>{m.pending ? "enviando…" : hhmm(m.created_at)}</time>
          </div>
          <div className="txt"><Body text={m.body} /></div>
          {m.failed && (
            <button className="ghost tiny" onClick={() => onResend(m.id)}>
              no se envió · reintentar
            </button>
          )}
          <button className={"ib x" + (armed === m.id ? " arm" : "")}
            onClick={() => ask(m.id)} aria-label="Borrar mensaje">
            {armed === m.id ? "¿seguro?" : "✕"}
          </button>
        </div>
      ))}
    </div>
  );
}
