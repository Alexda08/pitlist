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
  App.jsx                   # TODO el UI: Landing (crear/entrar garaje) + Garage + router por hash
  storage.js                # capa de datos Supabase: create/fetch/mutate/subscribe
  config.js                 # SUPABASE_URL + SUPABASE_ANON_KEY (publishable key, pública por diseño)
  styles.css                # design system completo (variables en :root)
supabase.sql                # esquema + RLS + realtime (ya ejecutado en el proyecto)
.github/workflows/deploy.yml
```

## Modelo de datos

Una sola tabla `garages(code text pk, data jsonb, created_at, updated_at)`. Todo el estado de un garaje vive en el blob `data`:

```json
{
  "projects": [{ "id": "abc123", "name": "Nissan 200SX", "code": "S13" }],
  "parts": {
    "abc123": [{
      "id": "...", "name": "CP Pistons SC7345", "url": "https://...", 
      "price": 850, "qty": 1,
      "status": "pendiente" | "pedido" | "recibido",
      "by": "Alex", "ts": 1753...,
      "trolled": true, "trolledBy": "Colega"   // opcionales
    }]
  },
  "updatedAt": 1753...
}
```

**Patrón de escritura** (`mutateGarage` en storage.js): read-latest → aplicar mutación → write. Last-write-wins a nivel de blob; aceptable para grupos pequeños. NO cambiar a escrituras parciales sin repensar concurrencia.

**Sync**: suscripción Realtime al UPDATE de la fila (`subscribeGarage`) + polling de respaldo cada 30s por si el WS cae.

**RLS**: select/insert/update abiertos a todos, DELETE sin policy a propósito (nadie borra salas desde cliente). El código de sala (6 chars, alfabeto sin ambiguos 0/O/1/I/L, generado con `crypto.getRandomValues`) es la única barrera.

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

## Estado actual

- ✅ Garajes por código, realtime, proyectos con placas, piezas (nombre/link/precio/uds), estados pendiente→pedido→recibido, totales por-gastar/gastado, zona de troleo con sello, nombre de autor por navegador (localStorage), copiar link de invitación.
- ✅ Deploy funcionando de punta a punta.

## Roadmap acordado (NO implementado — pedir plan antes de empezar)

Por orden de prioridad hablado con Alex:

1. **Galería pública de builds** ("top tier"): publicar proyecto individual como build de solo lectura (opt-in, despublicable), portada con orden por votos/gasto/reciente, filtro por chasis, votos sin login (token navegador + IP), **clonar build** a tu garaje. Antispam: requisitos de antigüedad/nº piezas para publicar, botón reportar, vista admin de moderación.
2. **PIN de escritura** opcional por sala (lectura por código, escritura por PIN).
3. **Migración a backend propio** en alexaiserver (FastAPI + SQLite + WS, docker-compose + Caddy) cuando la galería lo justifique. La capa `storage.js` está aislada precisamente para poder cambiar el backend sin tocar `App.jsx`.
4. Cuentas: explícitamente aplazado. No proponer login salvo que Alex lo saque.

## Ideas sueltas mencionadas (no comprometidas)

- Links de tiendas afiliables como monetización futura de la galería.
- Notas por pieza y categorías (motor/frenos/chasis) — se preguntó, sin decisión.
