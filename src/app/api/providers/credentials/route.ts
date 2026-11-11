import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { credentialStatus, saveCredential, deleteCredential, CREDENTIAL_PROVIDERS, isCredentialProvider } from "@/lib/providers/credentials";
import { routeAvailability } from "@/lib/collection/orchestrator";
import { enabledEngines } from "@/lib/providers/engine-scope";
import { withErrorHandling } from "@/lib/http/respond";

/** Which providers are usable, which collection routes that unlocks, and which engines the product measures. Never returns the keys themselves. */
async function snapshot() {
  return { status: await credentialStatus(), routes: routeAvailability(), engines: enabledEngines() };
}

export async function GET() {
  return withErrorHandling(async () => NextResponse.json(await snapshot()));
}

const BodySchema = z.object({
  provider: z.enum(CREDENTIAL_PROVIDERS),
  apiKey: z.string().trim().min(8).max(400),
});

export async function POST(req: NextRequest) {
  return withErrorHandling(async () => {
    const body = BodySchema.parse(await req.json());
    await saveCredential(body.provider, body.apiKey);
    return NextResponse.json(await snapshot());
  });
}

export async function DELETE(req: NextRequest) {
  return withErrorHandling(async () => {
    const provider = req.nextUrl.searchParams.get("provider");
    if (isCredentialProvider(provider)) await deleteCredential(provider);
    return NextResponse.json(await snapshot());
  });
}
