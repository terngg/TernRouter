import { NextResponse } from "next/server";
import { testCustomProviderConnection } from "@/lib/customProviders/manager.js";
import { getCustomProviderById } from "@/lib/db/repos/customProvidersRepo.js";
import { decryptSecret } from "@/lib/crypto.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/custom-providers/test - Test ad-hoc connection before saving
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const result = await testCustomProviderConnection(body);
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
