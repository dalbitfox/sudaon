// A Marketplace installation uses KV_* by default. Keep each URL/token pair
// together so a partial manual setup cannot mix credentials from two stores.
export function cloudConfiguration(env = process.env) {
  const redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }
    : { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
  const setup = {
    storage: Boolean(redis.url?.startsWith("https://") && redis.token),
    ownerPassword: Boolean(env.SUDAON_OWNER_PASSWORD?.length >= 12),
    sessionSecret: Boolean(env.SUDAON_SESSION_SECRET?.length >= 32),
  };
  return { redis, setup, configured: Object.values(setup).every(Boolean) };
}
