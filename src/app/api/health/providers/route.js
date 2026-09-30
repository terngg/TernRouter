import { NextResponse } from "next/server";
import { getProviderHealthSummary } from "@/lib/health/healthChecker.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/providers
 * Returns all latest provider and model health records
 */
export async function GET() {
  try {
    const summary = await getProviderHealthSummary();
    return NextResponse.json({ health: summary });
  } catch (error) {
    console.error("[API] Failed to get provider health summary:", error);
    return NextResponse.json({ error: "Failed to fetch health data" }, { status: 500 });
  }
}
