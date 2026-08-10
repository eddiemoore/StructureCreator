import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SchemaTree, Plugin, CreateResult, UndoResult } from "../types/schema";

vi.mock("./api", () => ({
  api: {
    fileSystem: {
      exists: vi.fn(),
    },
    validation: {
      validateSchema: vi.fn(),
      validateVariables: vi.fn(),
    },
    structureCreator: {
      createStructure: vi.fn(),
      createStructureFromTree: vi.fn(),
      generateDiffPreview: vi.fn(),
      undoStructure: vi.fn(),
    },
    schema: {
      exportSchemaXml: vi.fn(),
    },
    database: {
      addRecentProject: vi.fn(),
    },
  },
}));

vi.mock("./plugins", () => ({
  getPluginRuntime: vi.fn(),
  processTreeContent: vi.fn(),
}));

import { api } from "./api";
import { getPluginRuntime, processTreeContent } from "./plugins";
import { preview, create, undo, type CreationInputs, type CreationReporter } from "./creationRun";

const mockExists = vi.mocked(api.fileSystem.exists);
const mockValidateSchema = vi.mocked(api.validation.validateSchema);
const mockValidateVariables = vi.mocked(api.validation.validateVariables);
const mockCreateStructure = vi.mocked(api.structureCreator.createStructure);
const mockCreateFromTree = vi.mocked(api.structureCreator.createStructureFromTree);
const mockDiffPreview = vi.mocked(api.structureCreator.generateDiffPreview);
const mockUndoStructure = vi.mocked(api.structureCreator.undoStructure);
const mockAddRecentProject = vi.mocked(api.database.addRecentProject);
const mockGetRuntime = vi.mocked(getPluginRuntime);
const mockProcessTree = vi.mocked(processTreeContent);

const tree: SchemaTree = {
  root: {
    id: "root-1",
    type: "folder",
    name: "proj",
    children: [{ id: "f-1", type: "file", name: "index.ts" }],
  },
  stats: { folders: 1, files: 1, downloads: 0 },
};

const okSummary = {
  folders_created: 1,
  files_created: 1,
  files_downloaded: 0,
  files_generated: 0,
  skipped: 0,
  errors: 0,
  hooks_executed: 0,
  hooks_failed: 0,
};

const okResult: CreateResult = {
  logs: [{ log_type: "success", message: "created proj", details: undefined }],
  summary: okSummary,
  created_items: [{ path: "/out/proj", item_type: "folder", pre_existed: false }],
} as CreateResult;

const baseInputs = (over?: Partial<CreationInputs>): CreationInputs => ({
  tree,
  content: "<folder name=\"proj\"/>",
  variables: [{ name: "NAME", value: "proj" } as CreationInputs["variables"][number]],
  outputPath: "/out",
  projectName: "proj",
  overwrite: false,
  plugins: [],
  schemaPath: null,
  ...over,
});

const makeReporter = () => {
  const logs: { type: string; message: string }[] = [];
  const progress: unknown[] = [];
  const reporter: CreationReporter = {
    onLog: (e) => logs.push({ type: e.type, message: e.message }),
    onProgress: (p) => progress.push(p),
    onValidationErrors: vi.fn(),
    onDiffStart: vi.fn(),
  };
  return { reporter, logs, progress };
};

const validSchema = { isValid: true, errors: [], warnings: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockValidateSchema.mockResolvedValue(validSchema as never);
  mockValidateVariables.mockResolvedValue([]);
});

describe("preview", () => {
  it("returns the diff and fires onDiffStart after validation passes", async () => {
    const diff = { root: { id: "d1" }, summary: {} } as never;
    mockDiffPreview.mockResolvedValue(diff);
    const { reporter } = makeReporter();

    const inputs = baseInputs({
      variables: [{ name: "NAME", value: "x", validation: { required: true } } as never],
    });
    const outcome = await preview(inputs, reporter);

    expect(outcome).toEqual({ ok: true, diff });
    expect(reporter.onDiffStart).toHaveBeenCalledOnce();
    // projectName reaches the preview so it completes the same Variable map
    // creation does (ADR-0004)
    expect(mockDiffPreview).toHaveBeenCalledWith(tree, "/out", { NAME: "x" }, false, "proj");
  });

  it("stops at validation failure without computing the diff", async () => {
    const errors = [{ variable_name: "NAME", message: "required" }] as never;
    mockValidateVariables.mockResolvedValue(errors);
    const { reporter } = makeReporter();

    const inputs = baseInputs({
      variables: [{ name: "NAME", value: "", validation: { required: true } } as never],
    });
    const outcome = await preview(inputs, reporter);

    expect(outcome).toEqual({ ok: false, stage: "validation" });
    expect(reporter.onValidationErrors).toHaveBeenCalledWith(errors);
    expect(reporter.onDiffStart).not.toHaveBeenCalled();
    expect(mockDiffPreview).not.toHaveBeenCalled();
  });

  it("reports a diff-stage failure with the error message", async () => {
    mockDiffPreview.mockRejectedValue(new Error("disk unreadable"));
    const { reporter } = makeReporter();

    const outcome = await preview(baseInputs(), reporter);

    expect(outcome).toEqual({ ok: false, stage: "diff", error: "disk unreadable" });
  });
});

describe("create", () => {
  it("aborts when the output path no longer exists", async () => {
    mockExists.mockResolvedValue(false);
    const { reporter, logs, progress } = makeReporter();

    const outcome = await create(baseInputs(), reporter);

    expect(outcome).toEqual({ ok: false, summary: null, createdItems: null });
    expect(logs).toContainEqual({
      type: "error",
      message: "Create aborted: output path no longer exists",
    });
    expect(progress).toContainEqual({ status: "error" });
    expect(mockCreateStructure).not.toHaveBeenCalled();
    expect(mockCreateFromTree).not.toHaveBeenCalled();
  });

  it("stops on schema validation errors before creating", async () => {
    mockValidateSchema.mockResolvedValue({
      isValid: false,
      errors: [{ message: "bad xml" }],
      warnings: [],
    } as never);
    const { reporter, logs } = makeReporter();

    const outcome = await create(baseInputs(), reporter);

    expect(outcome.ok).toBe(false);
    expect(logs).toContainEqual({ type: "error", message: "bad xml" });
    expect(mockCreateStructure).not.toHaveBeenCalled();
  });

  it("creates from content, maps backend logs, records history, returns created items", async () => {
    mockCreateStructure.mockResolvedValue(okResult);
    const { reporter, logs, progress } = makeReporter();

    const outcome = await create(
      baseInputs({ schemaPath: "template:React App" }),
      reporter
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toEqual(okSummary);
    expect(outcome.createdItems).toEqual(okResult.created_items);
    expect(mockCreateStructure).toHaveBeenCalledWith('<folder name="proj"/>', {
      outputPath: "/out",
      variables: { NAME: "proj" },
      dryRun: false,
      overwrite: false,
      projectName: "proj",
    });
    expect(logs).toContainEqual({ type: "success", message: "created proj" });
    expect(progress).toContainEqual({ status: "completed" });
    expect(mockAddRecentProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "proj",
        templateName: "React App",
        foldersCreated: 1,
        filesCreated: 1,
      })
    );
  });

  it("returns ok:false with the summary when the backend reports errors, and skips history", async () => {
    mockCreateStructure.mockResolvedValue({
      ...okResult,
      summary: { ...okSummary, errors: 2 },
      created_items: [],
    });
    const { reporter, progress } = makeReporter();

    const outcome = await create(baseInputs(), reporter);

    expect(outcome.ok).toBe(false);
    expect(outcome.summary?.errors).toBe(2);
    expect(outcome.createdItems).toBeNull();
    expect(progress).toContainEqual({ status: "error" });
    expect(mockAddRecentProject).not.toHaveBeenCalled();
  });

  it("uses tree-based creation when plugins processed the tree", async () => {
    const processedTree = { ...tree, stats: { ...tree.stats } };
    const plugin = {
      id: "p1",
      is_enabled: true,
      capabilities: ["file-processor"],
    } as unknown as Plugin;
    mockGetRuntime.mockReturnValue({
      loadPlugins: vi.fn().mockResolvedValue(undefined),
      hasProcessors: () => true,
    } as never);
    mockProcessTree.mockResolvedValue(processedTree);
    mockCreateFromTree.mockResolvedValue(okResult);
    const { reporter } = makeReporter();

    const outcome = await create(baseInputs({ plugins: [plugin] }), reporter);

    expect(outcome.ok).toBe(true);
    expect(mockCreateFromTree).toHaveBeenCalledWith(processedTree, expect.anything());
    expect(mockCreateStructure).not.toHaveBeenCalled();
  });

  it("falls back to the original tree with a warning when plugin processing fails", async () => {
    const plugin = {
      id: "p1",
      is_enabled: true,
      capabilities: ["file-processor"],
    } as unknown as Plugin;
    mockGetRuntime.mockImplementation(() => {
      throw new Error("runtime broken");
    });
    mockCreateStructure.mockResolvedValue(okResult);
    const { reporter, logs } = makeReporter();

    const outcome = await create(baseInputs({ plugins: [plugin] }), reporter);

    expect(outcome.ok).toBe(true);
    expect(logs).toContainEqual({
      type: "warning",
      message: "Plugin processing warning: runtime broken",
    });
    expect(mockCreateStructure).toHaveBeenCalled();
  });

  it("survives history-recording failure", async () => {
    mockCreateStructure.mockResolvedValue(okResult);
    mockAddRecentProject.mockRejectedValue(new Error("db locked"));
    const { reporter } = makeReporter();

    const outcome = await create(baseInputs(), reporter);

    expect(outcome.ok).toBe(true);
  });
});

describe("undo", () => {
  const items = [{ path: "/out/proj", item_type: "folder", pre_existed: false }] as never;

  it("returns ok and the summary on a clean undo", async () => {
    const result: UndoResult = {
      logs: [{ log_type: "success", message: "deleted", details: undefined }],
      summary: { files_deleted: 1, folders_deleted: 1, items_skipped: 0, errors: 0 },
    } as UndoResult;
    mockUndoStructure.mockResolvedValue(result);
    const { reporter, progress } = makeReporter();

    const outcome = await undo(items, reporter);

    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toEqual(result.summary);
    expect(progress).toContainEqual({ status: "completed" });
    expect(mockUndoStructure).toHaveBeenCalledWith(items, false);
  });

  it("returns ok:false but still the summary when some deletions failed", async () => {
    mockUndoStructure.mockResolvedValue({
      logs: [],
      summary: { files_deleted: 0, folders_deleted: 0, items_skipped: 0, errors: 3 },
    } as UndoResult);
    const { reporter, progress } = makeReporter();

    const outcome = await undo(items, reporter);

    expect(outcome.ok).toBe(false);
    expect(outcome.summary?.errors).toBe(3);
    expect(progress).toContainEqual({ status: "error" });
  });

  it("returns a null summary when the undo call throws", async () => {
    mockUndoStructure.mockRejectedValue(new Error("ipc down"));
    const { reporter, logs } = makeReporter();

    const outcome = await undo(items, reporter);

    expect(outcome).toEqual({ ok: false, summary: null });
    expect(logs.some((l) => l.type === "error" && l.message.includes("Undo failed"))).toBe(true);
  });
});
