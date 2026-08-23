import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {resolve} from "node:path";

export default defineConfig({
    plugins: [react()],
    publicDir: false,
    build: {
        emptyOutDir: true,
        lib: {
            entry: resolve(import.meta.dirname, "client/entries/foundation.js"),
            formats: ["es"]
        },
        outDir: resolve(import.meta.dirname, "src/public/build"),
        rolldownOptions: {
            input: {
                foundation: resolve(import.meta.dirname, "client/entries/foundation.js")
            },
            output: {
                chunkFileNames: "chunks/[name]-[hash].js",
                entryFileNames: "[name].js"
            }
        }
    }
});
