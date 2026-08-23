import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {resolve} from "node:path";

export default defineConfig({
    plugins: [react()],
    publicDir: false,
    build: {
        emptyOutDir: true,
        outDir: resolve(import.meta.dirname, "src/public/build"),
        rolldownOptions: {
            input: {
                account: resolve(import.meta.dirname, "client/entries/account.jsx"),
                shell: resolve(import.meta.dirname, "client/entries/shell.js")
            },
            output: {
                chunkFileNames: "chunks/[name]-[hash].js",
                entryFileNames: "[name].js"
            }
        }
    }
});
