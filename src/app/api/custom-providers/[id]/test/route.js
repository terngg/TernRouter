import { NextResponse } from "next/server";
import { testCustomProviderConnection } from "@/lib/customProviders/manager.js";
import { getCustomProviderById } from "@/lib/db/repos/customProvidersRepo.js";
import { decryptSecret } from "@/lib/crypto.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/custom-providers/[id]/test - Test existing custom provider
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const provider = await getCustomProviderById(id, true);
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const apiKey = provider.encryptedApiKey ? decryptSecret(provider.encryptedApiKey) : "";
    const result = await testCustomProviderConnection({
      baseUrl: provider.baseUrl,
      authHeader: provider.authHeader,
      authPrefix: provider.authPrefix,
      apiKey,
      timeoutMs: provider.timeoutMs,
      customHeaders: provider.customHeaders,
      models: provider.models,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Error testing custom provider:", error);
    return NextResponse.json({
      success: false,
      status: 500,
      latencyMs: 0,
      error: error.message || "Test failed",
    });
  }
}
