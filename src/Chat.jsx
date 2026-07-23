import { useEffect, useRef, useState } from "react";
import { MessageList, Composer } from "./Messages.jsx";

/* Chat de la sala. En escritorio es un dock; en móvil, hoja a pantalla casi
   completa reutilizando el fondo de la hoja de "+ Pieza". */

const label = (p, cid) => (p.clientId === cid ? "tú" : p.name?.trim() || "anónimo");

// Quién está en el garaje ahora mismo. Presencia efímera del canal: no se guarda.
export function Presence({ people, cid, names = false }) {
  if (!people.length) return null;
  const list = people.map((p) => label(p, cid));
  return (
    <span className="presence" title={list.join(", ")}>
      {people.slice(0, 4).map((p) => <span key={p.clientId} className="dot" />)}
      <span className="txt">{names ? list.join(", ") : `${people.length} en el garaje`}</span>
    </span>
  );
}

export function Chat({ M, me, onName, onClose }) {
  const boxRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const count = M.chat.length;

  useEffect(() => {
    if (!atBottom) return;
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    M.markRead();
    // M fuera de deps: su identidad cambia con cada mensaje y esto se relanzaría solo.
  }, [count, atBottom]);

  const onScroll = () => {
    const el = boxRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <>
      <div className="sheetbg chatbg" onClick={onClose} />
      <section className="chatdock" role="dialog" aria-label="Chat del garaje">
        <header>
          <h3>Chat</h3>
          <Presence people={M.people} cid={M.cid} names />
          <button className="ib" onClick={onClose} aria-label="Cerrar chat">✕</button>
        </header>
        <div className="chatbox" ref={boxRef} onScroll={onScroll}>
          <MessageList items={M.chat} cid={M.cid} onDelete={M.remove} onResend={M.resend}
            empty="Nadie ha dicho nada todavía." />
        </div>
        {!atBottom && (
          <button className="newmsgs" onClick={() => setAtBottom(true)}>↓ ir al final</button>
        )}
        <Composer me={me} onName={onName} autoFocus
          placeholder="Escribe en el garaje…" onSend={(t) => M.send(t)} />
      </section>
    </>
  );
}
