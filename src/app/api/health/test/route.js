import { NextResponse } from "next/server";
import {
  testAllModelsHealth,
  testProviderHealth,
  testModelHealth,
} from "@/lib/health/healthChecker.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/health/test
 * Body:
 *   - mode: "all" | "provider" | "model"
 *   - provider?: string
 *   - model?: string
 *   - connectionId?: string
 *   - force?: boolean
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { mode = "all", provider, model, connectionId, force = false } = body;

    if (mode === "model") {
      if (!provider || !model) {
        return NextResponse.json({ error: "provider and model are required for model test" }, { status: 400 });
      }
      const result = await testModelHealth(provider, model, { force, connectionId });
      return NextResponse.json({ result });
    }

    if (mode === "provider") {
      if (!provider) {
        return NextResponse.json({ error: "provider is required for provider test" }, { status: 400 });
      }
      const results = await testProviderHealth(provider, { force });
      return NextResponse.json({ results });
    }

    if (mode === "all") {
      const results = await testAllModelsHealth({ force });
      return NextResponse.json({ results });
    }

    return NextResponse.json({ error: "Invalid test mode. Use: all, provider, or model" }, { status: 400 });
  } catch (error) {
    console.error("[API] Error in health check test:", error);
    return NextResponse.json({ error: "Health test failed" }, { status: 500 });
  }
}
