import { NextResponse } from "next/server";
import {
  getCustomProviderById,
  updateCustomProvider,
  deleteCustomProvider,
} from "@/lib/db/repos/customProvidersRepo.js";
import { encryptSecret } from "@/lib/crypto.js";
import { validateTargetUrl } from "@/lib/network/ssrf.js";

// GET /api/custom-providers/[id]
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const provider = await getCustomProviderById(id);
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    return NextResponse.json({ provider });
  } catch (error) {
    console.error("[API] Failed to get custom provider:", error);
    return NextResponse.json({ error: "Failed to fetch provider" }, { status: 500 });
  }
}

// PUT /api/custom-providers/[id]
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const existing = await getCustomProviderById(id, true);
    if (!existing) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    if (body.baseUrl && body.baseUrl !== existing.baseUrl) {
      const urlCheck = await validateTargetUrl(body.baseUrl);
      if (!urlCheck.safe) {
        return NextResponse.json({ error: urlCheck.error || "Invalid or disallowed Base URL" }, { status: 400 });
      }
    }

    const updateData = { ...body };
    if (body.apiKey) {
      updateData.encryptedApiKey = encryptSecret(body.apiKey);
      delete updateData.apiKey;
    }

    const updated = await updateCustomProvider(id, updateData);
    delete updated.encryptedApiKey;

    return NextResponse.json({ provider: updated });
  } catch (error) {
    console.error("[API] Failed to update custom provider:", error);
    return NextResponse.json({ error: error.message || "Failed to update provider" }, { status: 500 });
  }
}

// DELETE /api/custom-providers/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteCustomProvider(id);
    if (!deleted) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: "Provider deleted" });
  } catch (error) {
    console.error("[API] Failed to delete custom provider:", error);
    return NextResponse.json({ error: "Failed to delete provider" }, { status: 500 });
  }
}
