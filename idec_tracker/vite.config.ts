import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";

export default defineConfig({
  plugins: [reactRouter()],
  publicDir: path.resolve(__dirname, "../public"),
  server: {
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "../public")]
    }
  }
});
