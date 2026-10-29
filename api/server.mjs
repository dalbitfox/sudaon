import { createApplication } from "../server/app.mjs";
// External event storage is mandatory in Vercel. No ephemeral SQLite fallback.
const { server } = await createApplication();
export default server;
