# HANDOFF — PitList (3 Stage Garage)

> Documento de traspaso para Claude Code. Leer entero antes de tocar código.

## Qué es

Web de listas de piezas de coche compartidas por "garajes" (salas con código). Producto de 3 Stage Garage. Sin cuentas ni login: el código de garaje es la llave (lectura + escritura). Usuarios iniciales: Alex y su colega, con vocación de abrirse a más gente.

**Producción**: https://alexda08.github.io/pitlist/ (GitHub Pages, deploy automático por Action en cada push a `main`).

## Stack

- **Frontend**: React 18 + Vite, JS plano (sin TS por ahora), CSS artesanal en `src/styles.css` (sin Tailwind).
- **Datos**: Supabase free tier — Postgres + Realtime. Proyecto: `xwddmnwkfmocnmueqicp`.
- **Deploy**: GitHub Actions → Pages. Workflow en `.github/workflows/deploy.yml` (usa `npm ci` → el `package-lock.json` DEBE estar commiteado).

## Estructura

```
index.html                  # entry Vite
vite.config.js              # base: './' — necesario para Pages, NO tocar
src/
  main.jsx                  # bootstrap React
  App.jsx                   # Landing (crear/entrar garaje) + Garage + router por hash
  useMessages.js            # estado de chat y comentarios: una carga y una suscripción por garaje
  Messages.jsx              # <MessageList> y <Composer>, compartidos por chat y comentarios
  Chat.jsx                  # dock/hoja del chat de sala + <Presence>
  storage.js                # capa de datos Supabase: garaje (blob) y mensajes (tabla)
  config.js                 # SUPABASE_URL + SUPABASE_ANON_KEY (publishable key, pública por diseño)
  styles.css                # design system completo (variables en :root)
supabase.sql                # esquema + RLS + realtime (ya ejecutado en el proyecto)
.github/workflows/deploy.yml
```

## Modelo de datos

Dos tablas, y la separación importa: `garages` (el blob del garaje) y `garage_messages` (chat y comentarios).

### `garages` — el blob

`garages(code text pk, data jsonb, created_at, updated_at)`. Todo el estado de un garaje vive en el blob `data`:

```json
{
  "projects": [{ "id": "abc123", "name": "Nissan 200SX", "code": "S13" }],
  "parts": {
    "abc123": [{
      "id": "...", "name": "CP Pistons SC7345", "url": "https://...", 
      "price": 850, "qty": 1,
      "status": "pendiente" | "pedido" | "recibido",
      "by": "Alex", "ts": 1753...,
      "trolled": true, "trolledBy": "Colega",  // opcionales
      "next": true, "nextTs": 1753...          // opcionales: cola "siguiente compra"
                                               // (nextTs solo ordena; reordenar la cola lo renumera 1..n)
    }]
  },
  "updatedAt": 1753...
}
```

**Patrón de escritura** (`mutateGarage` en storage.js): read-latest → aplicar mutación → write. Last-write-wins a nivel de blob; aceptable para grupos pequeños. NO cambiar a escrituras parciales sin repensar concurrencia.

**Sync**: suscripción Realtime al UPDATE de la fila (`subscribeGarage`) + polling de respaldo cada 30s por si el WS cae.

**RLS**: select/insert/update abiertos a todos, DELETE sin policy a propósito (nadie borra salas desde cliente). El código de sala (6 chars, alfabeto sin ambiguos 0/O/1/I/L, generado con `crypto.getRandomValues`) es la única barrera.

### `garage_messages` — chat de sala y comentarios de pieza

Append-only, con `kind` = `'chat'` | `'comment'` (los comentarios llevan `part_id`; el CHECK lo obliga). Esquema completo en `supabase.sql`.

**Por qué NO viven en el blob** (no lo mováis ahí): el blob se reescribe **entero** en cada mutación con last-write-wins, así que un mensaje enviado mientras alguien edita una pieza pisaría esa edición — y con un chat esa ventana está abierta todo el rato, no de vez en cuando. Además el blob se descarga completo en la carga, en el polling de 30 s y en el *leer-último* de toda mutación.

**El `id` lo genera el navegador** (`crypto.randomUUID`), no el servidor. Eso hace que el eco del realtime deduplique por igualdad de id sin heurísticas, que el optimista se pinte con su id definitivo, y que **reenviar un mensaje tras un corte de red sea un no-op** en vez de un duplicado (se manda con `ignoreDuplicates`). El orden y los no leídos van por `seq` (identity), nunca por reloj de cliente.

**Sin policy de UPDATE**: un mensaje enviado es inmutable, garantizado en la base. Ojo: intentar editarlo no da error, devuelve 200 con 0 filas.

**Presencia** (quién está en la sala) es Realtime Presence: efímera, sin tabla ni columna. Se anuncia al **entrar al garaje**, no al abrir el chat.

## Convenciones de trabajo (obligatorias)

- **Plan primero**: proponer plan y esperar aprobación antes de implementar. Diffs mínimos — "solo fix y líneas", sin refactors oportunistas.
- Identificadores de código en inglés; UI y comentarios de cara a usuario en español.
- NUNCA usar `prompt()`/`confirm()`/`alert()` — todo con UI propia (ya hay patrones: form inline de proyecto, doble confirmación de borrado).
- Links externos de usuarios siempre con `rel="noopener noreferrer nofollow ugc"`.
- Mantener el design system de `styles.css` (placas con clip-path, mono para datos, acento rojo #e8402a, zona troleo morada). No meter Tailwind ni librerías UI sin hablarlo.
- No añadir dependencias sin justificar. La app es deliberadamente pequeña.

## Gotchas conocidas (aprendidas a hostias)

1. `SUPABASE_URL` es la base SIN `/rest/v1/` ni barra final (ya mordió una vez).
2. `base: './'` en vite.config es lo que hace funcionar Pages en subruta — no quitar.
3. Pages cachea fuerte: validar cambios con Ctrl+F5.
4. Supabase free **pausa el proyecto tras ~1 semana sin uso**: si todo da error de red de repente, reactivar desde el panel (los datos persisten).
5. El repo local de Alex vive en OneDrive\Desktop (pendiente mover a C:\dev): cuidado con locks raros de node_modules.
6. La "anon key" moderna se llama Publishable key (`sb_publishable_...`); el nombre de la constante se mantiene por compatibilidad.
7. **El payload de `DELETE` por realtime solo trae la PK** (replica identity por defecto), así que **no se puede filtrar por `garage_code`**: llegan los borrados de todas las salas y el cliente ignora los ids que no conoce. Si algún día hace falta filtrar, toca `replica identity full`.
8. **Presencia: escuchar solo `sync` no basta.** Cuando alguien que YA está presente se re-anuncia (p. ej. se pone el nombre), Supabase emite `join`, no `sync`, y quien estuviera mirando se queda con el dato viejo. Hay que recalcular también en `join` y `leave`.
9. **Re-anunciarse AÑADE una entrada** a la lista de ese cliente en vez de reemplazarla: el valor bueno es `metas[metas.length - 1]`, no `metas[0]`. Por eso el re-anuncio va con espera de 400 ms — el input del nombre escribe en cada tecla y si no, un nombre de 16 letras deja 16 entradas en la presencia de todos.
10. La salida de alguien tarda **~2 s** en propagarse (`untrack` o cerrar pestaña). No es un fallo: no lo midáis con esperas de 1 s.

## Estado actual

- ✅ Garajes por código, realtime, proyectos con placas, piezas (nombre/link/precio/uds), estados pendiente→pedido→recibido, totales por-gastar/gastado, zona de troleo con sello, nombre de autor por navegador (localStorage), copiar link de invitación.
- ✅ **Chat en vivo de la sala** (dock en escritorio, hoja en móvil), con no leídos, envío optimista con reintento seguro, borrado con doble confirmación y enlaces auto-detectados. Sin edición: los mensajes son inmutables.
- ✅ **Presencia**: quién está en el garaje ahora mismo, en la barra superior y en la cabecera del chat.
- ✅ **Comentarios por pieza** en hilo desplegable, con contador en la fila. Borrar una pieza o un build borra sus comentarios. La fila muestra un **preview del último comentario** (clicable, abre el hilo) y el 💬 se pinta en ámbar cuando hay conversación.
- ✅ **Cola "siguiente compra"**: botón 🎯 por pieza (flag `next`/`nextTs` en el blob, mismo patrón que `trolled`), sección propia encima de la lista con subtotal de la tanda y posición numerada. Al pasar a "pedido" o "recibido" la pieza sale sola de la cola. La fila de pieza es una función compartida (`partRow` en App.jsx) entre cola y lista.
- ✅ **Drag & drop para reordenar** (handle ⋮⋮): con pointer events propios, NO con el DnD nativo de HTML5 (no funciona en táctil). El orden manual ES el orden del array del blob; el orden por defecto del selector ahora es "manual". El drag en la lista solo se activa con orden "manual" + filtro "todas" (reordenar una lista filtrada/ordenada no está bien definido); en la cola 🎯 siempre. Mover va por ids, no por índices, y en la cola renumera `nextTs` 1..n.
- ✅ Deploy funcionando de punta a punta.

Pendiente menor: los comentarios están solo en la lista normal de piezas, **no en la zona de troleo** — se puede añadir con una línea si os apetece cebaros ahí.

## Roadmap acordado (NO implementado — pedir plan antes de empezar)

Por orden de prioridad hablado con Alex:

1. **Galería pública de builds** ("top tier"): publicar proyecto individual como build de solo lectura (opt-in, despublicable), portada con orden por votos/gasto/reciente, filtro por chasis, votos sin login (token navegador + IP), **clonar build** a tu garaje. Antispam: requisitos de antigüedad/nº piezas para publicar, botón reportar, vista admin de moderación.
2. **PIN de escritura** opcional por sala (lectura por código, escritura por PIN).
3. **Migración a backend propio** en alexaiserver (FastAPI + SQLite + WS, docker-compose + Caddy) cuando la galería lo justifique. La capa `storage.js` está aislada precisamente para poder cambiar el backend sin tocar `App.jsx`.
4. Cuentas: explícitamente aplazado. No proponer login salvo que Alex lo saque.

## Ideas sueltas mencionadas (no comprometidas)

- Links de tiendas afiliables como monetización futura de la galería.
- Notas por pieza y categorías (motor/frenos/chasis) — se preguntó, sin decisión.
- **Actividad en el chat**: que comentar una pieza deje una línea en el chat («Alex comentó en *CP Pistons SC7345*»), convirtiéndolo en el hilo de actividad del garaje. Salió al diseñar el chat y se dejó fuera para no inflar el alcance; para un grupo pequeño tiene sentido, pero es producto nuevo.
- El `client_id` (token opaco por navegador, en `localStorage`) ya está puesto y es justo el "token navegador" que pide el antispam de votos de la galería.
