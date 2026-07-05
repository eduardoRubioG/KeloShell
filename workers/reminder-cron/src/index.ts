export interface Env {
  REMINDER_DISPATCH_URL: string;
  REMINDER_DISPATCH_TOKEN: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
}

export default {
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(dispatchReminders(env));
  },
} satisfies ExportedHandler<Env>;

async function dispatchReminders(env: Env): Promise<void> {
  // Do NOT follow redirects: a 3xx means the request was diverted (edge
  // redirect or Access login) before reaching the JSON dispatcher. Treating
  // that as a failure (rather than silently following it) keeps a
  // misconfigured Access policy from looking like a silent success.
  const response = await fetch(env.REMINDER_DISPATCH_URL, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${env.REMINDER_DISPATCH_TOKEN}`,
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    },
  });

  const body = await response.text();
  console.log(`[reminder-cron] HTTP ${response.status}: ${body}`);

  if (response.status < 200 || response.status >= 300) {
    // Throwing lets Cloudflare's automatic Cron Trigger retry take over.
    throw new Error(`Reminder dispatch failed with HTTP ${response.status}`);
  }
}
