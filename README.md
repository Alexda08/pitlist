# PitList · 3 Stage Garage

Listas de piezas compartidas por garaje (sala con código). React + Vite en GitHub Pages, datos y realtime en Supabase.

## Setup (15 min)

### 1. Supabase (base de datos + realtime, gratis)

1. Cuenta en [supabase.com](https://supabase.com) → **New project** (región EU, p. ej. Frankfurt).
2. **SQL Editor** → pega el contenido de `supabase.sql` → Run.
3. **Settings > API** → copia `Project URL` y `anon public key`.
4. Pégalos en `src/config.js`.

> La anon key es pública por diseño; el acceso lo controlan las RLS policies del SQL.

### 2. GitHub Pages

1. Crea el repo en GitHub (público o privado, Pages funciona igual) y sube esto:
   ```bash
   git init && git add -A && git commit -m "feat: pitlist v1 con garajes por código"
   git branch -M main
   git remote add origin git@github.com:TUUSUARIO/pitlist.git
   git push -u origin main
   ```
2. En el repo: **Settings > Pages > Source: GitHub Actions**.
3. El workflow (`.github/workflows/deploy.yml`) compila y publica solo en cada push a `main`.
4. URL final: `https://TUUSUARIO.github.io/pitlist/`

### 3. Uso

- **Crear garaje** → genera código (ej. `K3M7XQ`) y link `.../#g=K3M7XQ`.
- Pasa el link (o el código) a quien quieras: entra sin registro, con lectura y escritura.
- El último garaje visitado se recuerda en el navegador.
- Sync en tiempo real vía websocket; polling de respaldo cada 30 s.

## Desarrollo local

```bash
npm install
npm run dev
```

## Modelo de confianza v1 (leer)

- Quien tiene el código de un garaje puede **leer y escribir** en él. Sin cuentas.
- Los códigos no son enumerables (6 chars, ~890M combinaciones), pero esto **no es privacidad fuerte**: no metáis direcciones, matrículas ni datos sensibles.
- No hay borrado de salas desde el cliente (sin policy DELETE). Limpieza manual desde el panel de Supabase si hace falta.

## Roadmap (hablado, no implementado)

- Galería pública de builds (opt-in por proyecto, solo lectura) + votos + clonar build.
- PIN de escritura por sala.
- Migración a backend propio (FastAPI + SQLite) en alexaiserver cuando toque.
