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
                builder: resolve(import.meta.dirname, "client/entries/builder.jsx"),
                items: resolve(import.meta.dirname, "client/entries/items.jsx"),
                "item-editor": resolve(import.meta.dirname, "client/entries/item-editor.jsx"),
                "mob-editor": resolve(import.meta.dirname, "client/entries/mob-editor.jsx"),
                "quest-editor": resolve(import.meta.dirname, "client/entries/quest-editor.jsx"),
                shell: resolve(import.meta.dirname, "client/entries/shell.js"),
                "wiki-editor": resolve(import.meta.dirname, "client/entries/wiki-editor.jsx")
            },
            output: {
                chunkFileNames: "chunks/[name]-[hash].js",
                entryFileNames: "[name].js"
            }
        }
    }
});
