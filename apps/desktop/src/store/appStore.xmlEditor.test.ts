import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "./appStore";
import type { SchemaTree } from "../types/schema";

// Mock the api module
vi.mock("../lib/api", () => ({
  api: {
    schema: {
      parseSchema: vi.fn(),
      exportSchemaXml: vi.fn(),
    },
  },
}));

// Import the mocked api
import { api } from "../lib/api";

const mockParseSchema = vi.mocked(api.schema.parseSchema);
const mockExportSchemaXml = vi.mocked(api.schema.exportSchemaXml);

const createMockTree = (name = "test-project"): SchemaTree => ({
  root: {
    id: "root-1",
    type: "folder",
    name,
    children: [
      { id: "file-1", type: "file", name: "index.ts" },
    ],
  },
  stats: { folders: 1, files: 1, downloads: 0 },
});

const sampleXml = `<folder name="test-project">
  <file name="index.ts" />
</folder>`;

describe("appStore XML editor state", () => {
  beforeEach(() => {
    // Reset the store before each test
    useAppStore.getState().reset();
    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("has correct initial XML editor state", () => {
      const state = useAppStore.getState();
      expect(state.editorMode).toBe("preview");
      expect(state.xmlEditorContent).toBeNull();
      expect(state.xmlParseError).toBeNull();
    });
  });

  describe("setXmlEditorContent", () => {
    it("updates XML content and marks schema as dirty", () => {
      useAppStore.getState().setXmlEditorContent(sampleXml);

      const state = useAppStore.getState();
      expect(state.xmlEditorContent).toBe(sampleXml);
      expect(state.schemaDirty).toBe(true);
    });

    it("allows setting empty string", () => {
      useAppStore.getState().setXmlEditorContent("");

      expect(useAppStore.getState().xmlEditorContent).toBe("");
    });
  });

  describe("setXmlParseError", () => {
    it("sets error message", () => {
      useAppStore.getState().setXmlParseError("Invalid XML syntax");

      expect(useAppStore.getState().xmlParseError).toBe("Invalid XML syntax");
    });

    it("clears error when set to null", () => {
      useAppStore.getState().setXmlParseError("Some error");
      useAppStore.getState().setXmlParseError(null);

      expect(useAppStore.getState().xmlParseError).toBeNull();
    });
  });

  describe("setEditorMode", () => {
    it("switches to preview mode", async () => {
      const result = await useAppStore.getState().setEditorMode("preview");

      expect(result).toBe(true);
      expect(useAppStore.getState().editorMode).toBe("preview");
      expect(useAppStore.getState().isEditMode).toBe(false);
    });

    it("switches to visual mode and sets isEditMode", async () => {
      const result = await useAppStore.getState().setEditorMode("visual");

      expect(result).toBe(true);
      expect(useAppStore.getState().editorMode).toBe("visual");
      expect(useAppStore.getState().isEditMode).toBe(true);
    });

    it("switches to xml mode and syncs tree to XML", async () => {
      const mockTree = createMockTree();
      mockExportSchemaXml.mockResolvedValue(sampleXml);

      // Set up a schema tree first
      useAppStore.setState({ schemaTree: mockTree });

      const result = await useAppStore.getState().setEditorMode("xml");

      expect(result).toBe(true);
      expect(useAppStore.getState().editorMode).toBe("xml");
      expect(mockExportSchemaXml).toHaveBeenCalledWith(mockTree);
      expect(useAppStore.getState().xmlEditorContent).toBe(sampleXml);
    });

    it("returns true when switching to same mode", async () => {
      useAppStore.setState({ editorMode: "preview" });

      const result = await useAppStore.getState().setEditorMode("preview");

      expect(result).toBe(true);
      // Should not call any API
      expect(mockParseSchema).not.toHaveBeenCalled();
      expect(mockExportSchemaXml).not.toHaveBeenCalled();
    });

    it("syncs XML to tree when leaving XML mode", async () => {
      const mockTree = createMockTree();
      mockParseSchema.mockResolvedValue(mockTree);

      // Set up XML mode with content
      useAppStore.setState({
        editorMode: "xml",
        xmlEditorContent: sampleXml,
      });

      const result = await useAppStore.getState().setEditorMode("preview");

      expect(result).toBe(true);
      expect(mockParseSchema).toHaveBeenCalledWith(sampleXml);
      expect(useAppStore.getState().editorMode).toBe("preview");
      expect(useAppStore.getState().schemaTree).toBeDefined();
    });

    it("stays in XML mode when sync fails", async () => {
      mockParseSchema.mockRejectedValue(new Error("Parse error"));

      // Set up XML mode with invalid content
      useAppStore.setState({
        editorMode: "xml",
        xmlEditorContent: "<invalid>",
      });

      const result = await useAppStore.getState().setEditorMode("preview");

      expect(result).toBe(false);
      expect(useAppStore.getState().editorMode).toBe("xml");
      expect(useAppStore.getState().xmlParseError).toBe("Parse error");
    });

    it("clears xmlParseError when switching modes successfully", async () => {
      useAppStore.setState({
        editorMode: "preview",
        xmlParseError: "Some old error",
      });

      await useAppStore.getState().setEditorMode("visual");

      expect(useAppStore.getState().xmlParseError).toBeNull();
    });
  });

  describe("syncXmlToTree", () => {
    it("parses XML content and updates schema tree", async () => {
      const mockTree = createMockTree();
      mockParseSchema.mockResolvedValue(mockTree);

      useAppStore.setState({ xmlEditorContent: sampleXml });

      const result = await useAppStore.getState().syncXmlToTree();

      expect(result).toBe(true);
      expect(mockParseSchema).toHaveBeenCalledWith(sampleXml);
      expect(useAppStore.getState().schemaTree?.root.name).toBe("test-project");
      expect(useAppStore.getState().schemaContent).toBe(sampleXml);
      expect(useAppStore.getState().xmlParseError).toBeNull();
    });

    it("adds to history when syncing", async () => {
      const mockTree = createMockTree();
      mockParseSchema.mockResolvedValue(mockTree);

      useAppStore.setState({
        xmlEditorContent: sampleXml,
        schemaHistory: [],
        schemaHistoryIndex: -1,
      });

      await useAppStore.getState().syncXmlToTree();

      const state = useAppStore.getState();
      expect(state.schemaHistory.length).toBe(1);
      expect(state.schemaHistoryIndex).toBe(0);
    });

    it("returns true when content is null", async () => {
      useAppStore.setState({ xmlEditorContent: null });

      const result = await useAppStore.getState().syncXmlToTree();

      expect(result).toBe(true);
      expect(mockParseSchema).not.toHaveBeenCalled();
    });

    it("sets error and returns false on parse failure", async () => {
      mockParseSchema.mockRejectedValue(new Error("Invalid XML: unexpected token"));

      useAppStore.setState({ xmlEditorContent: "<invalid>" });

      const result = await useAppStore.getState().syncXmlToTree();

      expect(result).toBe(false);
      expect(useAppStore.getState().xmlParseError).toBe("Invalid XML: unexpected token");
    });

    it("handles non-Error rejections", async () => {
      mockParseSchema.mockRejectedValue("String error message");

      useAppStore.setState({ xmlEditorContent: "<invalid>" });

      const result = await useAppStore.getState().syncXmlToTree();

      expect(result).toBe(false);
      expect(useAppStore.getState().xmlParseError).toBe("String error message");
    });
  });

  describe("syncTreeToXml", () => {
    it("exports tree to XML content", async () => {
      const mockTree = createMockTree();
      mockExportSchemaXml.mockResolvedValue(sampleXml);

      useAppStore.setState({ schemaTree: mockTree });

      await useAppStore.getState().syncTreeToXml();

      expect(mockExportSchemaXml).toHaveBeenCalledWith(mockTree);
      expect(useAppStore.getState().xmlEditorContent).toBe(sampleXml);
      expect(useAppStore.getState().xmlParseError).toBeNull();
    });

    it("sets null content when no tree exists", async () => {
      useAppStore.setState({
        schemaTree: null,
        xmlEditorContent: "old content",
      });

      await useAppStore.getState().syncTreeToXml();

      expect(useAppStore.getState().xmlEditorContent).toBeNull();
      expect(mockExportSchemaXml).not.toHaveBeenCalled();
    });

    it("sets error on export failure", async () => {
      const mockTree = createMockTree();
      mockExportSchemaXml.mockRejectedValue(new Error("Export failed"));

      useAppStore.setState({ schemaTree: mockTree });

      await useAppStore.getState().syncTreeToXml();

      expect(useAppStore.getState().xmlParseError).toBe("Export failed");
    });
  });

  describe("createNewSchema", () => {
    it("sets editor mode to visual", () => {
      useAppStore.getState().createNewSchema();

      const state = useAppStore.getState();
      expect(state.editorMode).toBe("visual");
      expect(state.isEditMode).toBe(true);
    });

    it("clears XML editor state", () => {
      useAppStore.setState({
        xmlEditorContent: "old content",
        xmlParseError: "old error",
      });

      useAppStore.getState().createNewSchema();

      const state = useAppStore.getState();
      expect(state.xmlEditorContent).toBeNull();
      expect(state.xmlParseError).toBeNull();
    });
  });

  describe("reset", () => {
    it("resets XML editor state to initial values", () => {
      // Set some state
      useAppStore.setState({
        editorMode: "xml",
        xmlEditorContent: sampleXml,
        xmlParseError: "Some error",
      });

      useAppStore.getState().reset();

      const state = useAppStore.getState();
      expect(state.editorMode).toBe("preview");
      expect(state.xmlEditorContent).toBeNull();
      expect(state.xmlParseError).toBeNull();
    });
  });

  describe("mode switching flow", () => {
    it("simulates complete flow: preview -> xml -> edit -> visual -> preview", async () => {
      const mockTree = createMockTree();
      mockExportSchemaXml.mockResolvedValue(sampleXml);
      mockParseSchema.mockResolvedValue(mockTree);

      // Start with a schema tree
      useAppStore.setState({ schemaTree: mockTree });

      // Switch to XML mode
      await useAppStore.getState().setEditorMode("xml");
      expect(useAppStore.getState().editorMode).toBe("xml");
      expect(useAppStore.getState().xmlEditorContent).toBe(sampleXml);

      // Edit the XML
      const editedXml = sampleXml.replace("test-project", "edited-project");
      useAppStore.getState().setXmlEditorContent(editedXml);

      // Update mock to return edited tree
      const editedTree = createMockTree("edited-project");
      mockParseSchema.mockResolvedValue(editedTree);

      // Switch to visual mode (should sync XML to tree)
      await useAppStore.getState().setEditorMode("visual");
      expect(useAppStore.getState().editorMode).toBe("visual");
      expect(mockParseSchema).toHaveBeenCalledWith(editedXml);

      // Switch to preview mode
      await useAppStore.getState().setEditorMode("preview");
      expect(useAppStore.getState().editorMode).toBe("preview");
    });
  });
});
