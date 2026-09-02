import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  base: "./",
  build: {
    rollupOptions: {
      input: "module-board.html",
    },
  },
});
