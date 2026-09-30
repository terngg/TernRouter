import { NextResponse } from "next/server";
import { getProjects, createProject } from "@/models";

export const dynamic = "force-dynamic";

// GET /api/projects - List all projects
export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("[API] Failed to get projects:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

// POST /api/projects - Create a new project
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      description,
      defaultModel,
      routingMode,
      allowedProviders,
      allowedModels,
      fallbackSequence,
      timeoutMs,
      usageLimit,
      isActive,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }

    const project = await createProject({
      name,
      description,
      defaultModel,
      routingMode,
      allowedProviders,
      allowedModels,
      fallbackSequence,
      timeoutMs,
      usageLimit,
      isActive,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error("[API] Failed to create project:", error);
    return NextResponse.json({ error: error.message || "Failed to create project" }, { status: 500 });
  }
}
