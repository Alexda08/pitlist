import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' = rutas relativas, funciona en usuario.github.io/repo sin tocar nada
export default defineConfig({
  plugins: [react()],
  base: "./",
});
