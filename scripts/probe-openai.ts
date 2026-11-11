// A few real questions through gpt-5-nano with the saved OpenAI key: checks the
// key, the balance, speed, token use and cost per answer. Never prints the key.
//
//   npx tsx scripts/probe-openai.ts "first question" "second question" ...
//
// With no questions given it asks one generic question.
import { getCredential, loadCredentials } from "@/lib/providers/credentials";

// Published gpt-5-nano prices, US dollars per million tokens.
const INPUT_PER_M = 0.05;
const OUTPUT_PER_M = 0.4;

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no local env file
  }
  await loadCredentials();
  const key = getCredential("openai");
  if (!key) {
    console.log("no OpenAI key saved yet: add OPENAI_API_KEY to .env.local");
    return;
  }
  const questions = process.argv.slice(2);
  if (questions.length === 0) questions.push("What are the best running shoes for beginners?");

  const started = Date.now();
  const results = await Promise.all(
    questions.map(async (question) => {
      const t0 = Date.now();
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-5-nano", messages: [{ role: "user", content: question }], max_completion_tokens: 6000 }),
      });
      const body = (await response.json()) as any;
      return { question, status: response.status, ms: Date.now() - t0, body, headers: response.headers };
    }),
  );

  let totalCost = 0;
  for (const { question, status, ms, body, headers } of results) {
    console.log(`\nQ: ${question}`);
    console.log(`status ${status} in ${ms}ms`);
    if (status !== 200) {
      console.log("error:", body.error?.code ?? body.error?.type ?? null, "-", body.error?.message ?? JSON.stringify(body));
      continue;
    }
    const usage = body.usage ?? {};
    const cost = ((usage.prompt_tokens ?? 0) * INPUT_PER_M + (usage.completion_tokens ?? 0) * OUTPUT_PER_M) / 1_000_000;
    totalCost += cost;
    console.log(
      `served by ${body.model ?? "?"} | finish ${body.choices?.[0]?.finish_reason ?? null} | tokens in ${usage.prompt_tokens ?? "?"}, out ${usage.completion_tokens ?? "?"} (reasoning ${usage.completion_tokens_details?.reasoning_tokens ?? "?"}) | ~$${cost.toFixed(5)}`,
    );
    console.log("limits:", [...headers.entries()].filter(([name]) => /ratelimit-(limit|remaining)-requests/i.test(name)).map(([name, value]) => `${name}=${value}`).join("  ") || "none");
    console.log("answer:", String(body.choices?.[0]?.message?.content ?? "").replace(/\s+/g, " ").slice(0, 220));
  }
  console.log(`\n${results.length} question(s) in ${Date.now() - started}ms, about $${totalCost.toFixed(4)} total`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
