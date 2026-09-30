import { NextResponse } from "next/server";
import { getCustomProviders, createCustomProvider } from "@/lib/db/repos/customProvidersRepo.js";
import { encryptSecret } from "@/lib/crypto.js";
import { validateTargetUrl } from "@/lib/network/ssrf.js";

export const dynamic = "force-dynamic";

// GET /api/custom-providers - List custom providers
export async function GET() {
  try {
    const rawProviders = await getCustomProviders();
    const providers = rawProviders.map((p) => {
      const copy = { ...p };
      delete copy.encryptedApiKey;
      return copy;
    });
    return NextResponse.json({ providers });
  } catch (error) {
    console.error("[API] Failed to get custom providers:", error);
    return NextResponse.json({ error: "Failed to fetch custom providers" }, { status: 500 });
  }
}

// POST /api/custom-providers - Create custom provider
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      baseUrl,
      apiType,
      authHeader,
      authPrefix,
      apiKey,
      models,
      timeoutMs,
      customHeaders,
      modelAliases,
      responseMapping,
      isActive,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Provider name is required" }, { status: 400 });
    }

    if (!baseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    // SSRF validation
    const urlCheck = await validateTargetUrl(baseUrl);
    if (!urlCheck.safe) {
      return NextResponse.json({ error: urlCheck.error || "Invalid or disallowed Base URL" }, { status: 400 });
    }

    const encryptedApiKey = apiKey ? encryptSecret(apiKey) : null;

    const provider = await createCustomProvider({
      name,
      baseUrl,
      apiType,
      authHeader,
      authPrefix,
      encryptedApiKey,
      models,
      timeoutMs,
      customHeaders,
      modelAliases,
      responseMapping,
      isActive,
    });

    const safeProvider = { ...provider };
    delete safeProvider.encryptedApiKey;

    return NextResponse.json({ provider: safeProvider }, { status: 201 });
  } catch (error) {
    console.error("[API] Failed to create custom provider:", error);
    return NextResponse.json({ error: error.message || "Failed to create custom provider" }, { status: 500 });
  }
}
