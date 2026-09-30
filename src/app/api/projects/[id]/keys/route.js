import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, getProjectById } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/projects/[id]/keys - List all keys belonging to this project
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const project = await getProjectById(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const keys = await getApiKeys({ projectId: id });
    return NextResponse.json({ keys });
  } catch (error) {
    console.error("[API] Failed to get project keys:", error);
    return NextResponse.json({ error: "Failed to fetch project keys" }, { status: 500 });
  }
}

// POST /api/projects/[id]/keys - Generate a new key bound to this project
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const project = await getProjectById(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const keyName = body.name?.trim() || `${project.name} Key`;

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(keyName, machineId, {
      projectId: id,
      permissions: {
        allowedProviders: project.allowedProviders,
        allowedModels: project.allowedModels,
      },
    });

    return NextResponse.json({ apiKey }, { status: 201 });
  } catch (error) {
    console.error("[API] Failed to generate project key:", error);
    return NextResponse.json({ error: "Failed to generate key" }, { status: 500 });
  }
}
