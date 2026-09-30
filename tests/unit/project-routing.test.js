import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let projectsRepo;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-project-test-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  projectsRepo = await import("@/lib/db/repos/projectsRepo.js");
});

afterEach(() => {
  delete process.env.DATA_DIR;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

describe("Per-Project Routing Profiles", () => {
  describe("Project CRUD operations", () => {
    it("creates a new project with sensible defaults", async () => {
      const project = await projectsRepo.createProject({
        name: "Tern CLI",
        description: "CLI routing profile",
        defaultModel: "claude-3-5-sonnet",
        routingMode: "quality",
        allowedProviders: ["anthropic", "openai", "google"],
        allowedModels: ["claude-3-5-sonnet", "gpt-4o", "gemini-1.5-pro"],
        fallbackSequence: ["gpt-4o", "gemini-1.5-pro"],
        timeoutMs: 45000,
        usageLimit: 50.0,
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe("Tern CLI");
      expect(project.defaultModel).toBe("claude-3-5-sonnet");
      expect(project.routingMode).toBe("quality");
      expect(project.allowedProviders).toEqual(["anthropic", "openai", "google"]);
      expect(project.fallbackSequence).toEqual(["gpt-4o", "gemini-1.5-pro"]);
      expect(project.timeoutMs).toBe(45000);
      expect(project.usageLimit).toBe(50.0);
      expect(project.currentSpend).toBe(0);
      expect(project.isActive).toBe(true);
    });

    it("retrieves project by ID and parses JSON lists correctly", async () => {
      const created = await projectsRepo.createProject({
        name: "Web App",
        defaultModel: "auto/balanced",
        fallbackSequence: ["gemini-1.5-flash", "gpt-4o-mini"],
      });

      const fetched = await projectsRepo.getProjectById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("Web App");
      expect(Array.isArray(fetched.fallbackSequence)).toBe(true);
      expect(fetched.fallbackSequence).toEqual(["gemini-1.5-flash", "gpt-4o-mini"]);
    });

    it("updates project configurations", async () => {
      const created = await projectsRepo.createProject({
        name: "Old Config",
        timeoutMs: 30000,
      });

      const updated = await projectsRepo.updateProject(created.id, {
        name: "New Config",
        timeoutMs: 60000,
        routingMode: "fast",
      });

      expect(updated.name).toBe("New Config");
      expect(updated.timeoutMs).toBe(60000);
      expect(updated.routingMode).toBe("fast");

      const fetched = await projectsRepo.getProjectById(created.id);
      expect(fetched.name).toBe("New Config");
    });

    it("increments project spend correctly", async () => {
      const created = await projectsRepo.createProject({
        name: "Budget Test",
        usageLimit: 10.0,
      });

      await projectsRepo.incrementProjectSpend(created.id, 0.05);
      await projectsRepo.incrementProjectSpend(created.id, 0.15);

      const fetched = await projectsRepo.getProjectById(created.id);
      expect(fetched.currentSpend).toBeCloseTo(0.2, 5);
    });

    it("deletes a project cleanly", async () => {
      const created = await projectsRepo.createProject({
        name: "To Delete",
      });

      const deleted = await projectsRepo.deleteProject(created.id);
      expect(deleted).toBe(true);

      const fetched = await projectsRepo.getProjectById(created.id);
      expect(fetched).toBeNull();
    });
  });

  describe("Project Routing & Budget Policies", () => {
    it("constructs candidate sequence prioritizing requested model followed by fallback sequence", () => {
      const project = {
        name: "Dev Profile",
        fallbackSequence: ["claude-3-5-sonnet", "gpt-4o", "gemini-1.5-pro"],
      };

      const requestedModel = "gpt-4o";
      const candidateSequence = [
        requestedModel,
        ...project.fallbackSequence.filter((m) => m !== requestedModel),
      ];

      expect(candidateSequence).toEqual(["gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"]);
    });

    it("detects budget limit exhaustion", () => {
      const projectActive = {
        name: "Active Project",
        usageLimit: 10.0,
        currentSpend: 5.5,
      };

      const projectExhausted = {
        name: "Exhausted Project",
        usageLimit: 10.0,
        currentSpend: 10.05,
      };

      const isOverBudget = (p) => p.usageLimit != null && p.currentSpend >= p.usageLimit;

      expect(isOverBudget(projectActive)).toBe(false);
      expect(isOverBudget(projectExhausted)).toBe(true);
    });
  });
});
