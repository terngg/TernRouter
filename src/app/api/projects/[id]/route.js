import { NextResponse } from "next/server";
import { getProjectById, updateProject, deleteProject } from "@/models";

// GET /api/projects/[id]
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const project = await getProjectById(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    console.error("[API] Failed to get project:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

// PUT /api/projects/[id]
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const existing = await getProjectById(id);
    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updated = await updateProject(id, body);
    return NextResponse.json({ project: updated });
  } catch (error) {
    console.error("[API] Failed to update project:", error);
    return NextResponse.json({ error: error.message || "Failed to update project" }, { status: 500 });
  }
}

// DELETE /api/projects/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteProject(id);
    if (!deleted) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: "Project deleted" });
  } catch (error) {
    console.error("[API] Failed to delete project:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
