import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import express from "express";
import { createApplication } from "./app.mjs";

export async function startLocal({
  port = Number(process.env.PORT) || 4173,
  host = "127.0.0.1",
  filename,
  dev = false,
  publicUrl,
} = {}) {
  const instance = await createApplication({ filename, publicUrl });
  if (dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    instance.app.use(vite.middlewares);
    const oldClose = instance.close;
    instance.close = async () => {
      await vite.close();
      await oldClose();
    };
  } else {
    const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
    instance.app.use(express.static(dist));
    instance.app.get("/{*path}", (req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  }
  await new Promise((ok, fail) => {
    instance.server.once("error", fail);
    instance.server.listen(port, host, ok);
  });
  return {
    ...instance,
    url: `http://127.0.0.1:${instance.server.address().port}`,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const instance = await startLocal({
    dev: process.argv.includes("--dev"),
    host: process.env.SUDAON_BIND || "127.0.0.1",
  });
  console.log(`수다온 Local: ${instance.url}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await instance.close();
      process.exit(0);
    });
}
