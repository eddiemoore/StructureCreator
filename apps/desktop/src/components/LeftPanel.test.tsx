import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { LeftPanel } from "./LeftPanel";
import { useAppStore } from "../store/appStore";
import type { Template, SchemaTree, Variable, ParseWithInheritanceResult } from "../types/schema";

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the api module using vi.hoisted to prevent hoisting issues
const { mockFileSystem, mockDatabase, mockSchema } = vi.hoisted(() => ({
  mockFileSystem: {
    openFilePicker: vi.fn(),
    openDirectoryPicker: vi.fn(),
    readTextFile: vi.fn(),
    readBinaryFile: vi.fn(),
    saveFilePicker: vi.fn(),
    writeTextFile: vi.fn(),
  },
  mockDatabase: {
    listTemplates: vi.fn(),
    getAllTags: vi.fn(),
    listRecentProjects: vi.fn(),
    createTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    toggleFavorite: vi.fn(),
    incrementUseCount: vi.fn(),
  },
  mockSchema: {
    parseSchemaWithInheritance: vi.fn(),
    scanFolder: vi.fn(),
    scanZip: vi.fn(),
    exportSchemaXml: vi.fn(),
    extractVariables: vi.fn(),
  },
}));

vi.mock("../lib/api", () => ({
  api: {
    fileSystem: mockFileSystem,
    database: mockDatabase,
    schema: mockSchema,
  },
}));

// Reference for tests
const mockApi = {
  fileSystem: mockFileSystem,
  database: mockDatabase,
  schema: mockSchema,
};

// ============================================================================
// Helper Functions
// ============================================================================

function createMockTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: `template-${Math.random().toString(36).slice(2, 9)}`,
    name: "Test Template",
    description: "A test template",
    schema_xml: "<folder name=\"test\"><file name=\"index.ts\" /></folder>",
    variables: {},
    variable_validation: {},
    icon_color: "#0a84ff",
    is_favorite: false,
    use_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    wizard_config: null,
    ...overrides,
  };
}

function createMockSchemaTree(overrides: Partial<SchemaTree> = {}): SchemaTree {
  return {
    root: {
      id: "root",
      type: "folder",
      name: "test-project",
      children: [
        { id: "file1", type: "file", name: "index.ts", content: "// entry" },
      ],
    },
    stats: {
      folders: 1,
      files: 1,
      downloads: 0,
    },
    ...overrides,
  };
}

function createMockParseResult(tree: SchemaTree = createMockSchemaTree()): ParseWithInheritanceResult {
  return {
    tree,
    mergedVariables: {},
    mergedVariableValidation: {},
    baseTemplates: [],
  };
}

function setupDefaultMocks() {
  mockApi.database.listTemplates.mockResolvedValue([]);
  mockApi.database.getAllTags.mockResolvedValue([]);
  mockApi.database.listRecentProjects.mockResolvedValue([]);
  mockApi.schema.extractVariables.mockResolvedValue([]);
  mockApi.schema.parseSchemaWithInheritance.mockResolvedValue(createMockParseResult());
}

function createSearchInputRef() {
  return { current: null } as React.RefObject<HTMLInputElement>;
}

function renderLeftPanel(props: Partial<React.ComponentProps<typeof LeftPanel>> = {}) {
  const defaultProps = {
    searchInputRef: createSearchInputRef(),
    onImportExportModalChange: vi.fn(),
  };
  return render(<LeftPanel {...defaultProps} {...props} />);
}

async function waitForDataLoad() {
  // Wait for initial API calls to complete
  await waitFor(() => {
    expect(mockApi.database.listTemplates).toHaveBeenCalled();
    expect(mockApi.database.getAllTags).toHaveBeenCalled();
    expect(mockApi.database.listRecentProjects).toHaveBeenCalled();
  });
}

function setupWithSchema(
  schemaContent: string = "<folder name=\"test\"><file name=\"index.ts\" /></folder>",
  schemaTree: SchemaTree = createMockSchemaTree()
) {
  useAppStore.getState().setSchemaContent(schemaContent);
  useAppStore.getState().setSchemaTree(schemaTree);
  useAppStore.getState().setSchemaPath("/test/schema.xml");
}

function setupWithVariables(variables: Variable[]) {
  useAppStore.getState().setVariables(variables);
}

// Helper to simulate typing in an input
function typeInInput(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

// ============================================================================
// Test Suite
// ============================================================================

describe("LeftPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    // Reset store state
    useAppStore.getState().reset();
    useAppStore.getState().setVariables([]);
    useAppStore.getState().setTemplates([]);
    useAppStore.getState().setTemplatesLoading(false);
    // Clear template filters (search, tags, sort) which aren't cleared by reset()
    useAppStore.getState().clearTemplateFilters();
  });

  afterEach(() => {
    // Don't use vi.restoreAllMocks() as it removes mock implementations
    // vi.clearAllMocks() is already called in beforeEach to clear call history
  });

  // ==========================================================================
  // Schema Source Section
  // ==========================================================================

  describe("Schema Source Section", () => {
    describe("source type toggle", () => {
      it("renders File and Folder toggle buttons", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        // Find buttons within the segment control
        const segmentControl = document.querySelector(".mac-segment");
        expect(segmentControl).toBeInTheDocument();
        const buttons = within(segmentControl as HTMLElement).getAllByRole("button");
        expect(buttons.length).toBe(2);
        expect(buttons[0]).toHaveTextContent(/file/i);
        expect(buttons[1]).toHaveTextContent(/folder/i);
      });

      it("defaults to File mode", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        const segmentControl = document.querySelector(".mac-segment");
        const fileButton = within(segmentControl as HTMLElement).getAllByRole("button")[0];
        expect(fileButton).toHaveClass("active");
      });

      it("switches to Folder mode when clicked", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        const segmentControl = document.querySelector(".mac-segment");
        const folderButton = within(segmentControl as HTMLElement).getAllByRole("button")[1];
        fireEvent.click(folderButton);

        expect(folderButton).toHaveClass("active");
        expect(screen.getByText(/select a folder/i)).toBeInTheDocument();
      });

      it("clears schema when switching modes", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        // Should show loaded schema info
        expect(screen.getByText(/lines/i)).toBeInTheDocument();

        // Switch to folder mode
        const segmentControl = document.querySelector(".mac-segment");
        const folderButton = within(segmentControl as HTMLElement).getAllByRole("button")[1];
        fireEvent.click(folderButton);

        // Schema should be cleared
        expect(screen.queryByText(/lines/i)).not.toBeInTheDocument();
        expect(useAppStore.getState().schemaPath).toBeNull();
      });
    });

    describe("file selection", () => {
      it("opens file picker when drop zone is clicked", async () => {
        mockApi.fileSystem.openFilePicker.mockResolvedValue(null);
        renderLeftPanel();
        await waitForDataLoad();

        const dropZone = screen.getByText(/select schema file/i).closest("button");
        expect(dropZone).toBeInTheDocument();

        fireEvent.click(dropZone!);

        await waitFor(() => {
          expect(mockApi.fileSystem.openFilePicker).toHaveBeenCalledWith({
            multiple: false,
            filters: expect.arrayContaining([
              expect.objectContaining({ name: "Schema Files", extensions: ["xml", "zip"] }),
            ]),
          });
        });
      });

      it("loads XML file and parses schema", async () => {
        const mockPath = "/test/schema.xml";
        const mockContent = "<folder name=\"project\"><file name=\"main.ts\" /></folder>";
        const mockTree = createMockSchemaTree();

        mockApi.fileSystem.openFilePicker.mockResolvedValue(mockPath);
        mockApi.fileSystem.readTextFile.mockResolvedValue(mockContent);
        mockApi.schema.parseSchemaWithInheritance.mockResolvedValue(createMockParseResult(mockTree));
        mockApi.schema.extractVariables.mockResolvedValue([]);

        renderLeftPanel();
        await waitForDataLoad();

        const dropZone = screen.getByText(/select schema file/i).closest("button");
        fireEvent.click(dropZone!);

        await waitFor(() => {
          expect(mockApi.fileSystem.readTextFile).toHaveBeenCalledWith(mockPath);
          expect(mockApi.schema.parseSchemaWithInheritance).toHaveBeenCalledWith(mockContent);
        });

        // Schema info should be displayed
        expect(useAppStore.getState().schemaPath).toBe(mockPath);
        expect(useAppStore.getState().schemaContent).toBe(mockContent);
      });

      it("loads ZIP file and scans contents", async () => {
        const mockPath = "/test/archive.zip";
        const mockData = new Uint8Array([1, 2, 3]);
        const mockTree = createMockSchemaTree();

        mockApi.fileSystem.openFilePicker.mockResolvedValue(mockPath);
        mockApi.fileSystem.readBinaryFile.mockResolvedValue(mockData);
        mockApi.schema.scanZip.mockResolvedValue(mockTree);
        mockApi.schema.exportSchemaXml.mockResolvedValue("<folder name=\"test\" />");
        mockApi.schema.extractVariables.mockResolvedValue([]);

        renderLeftPanel();
        await waitForDataLoad();

        const dropZone = screen.getByText(/select schema file/i).closest("button");
        fireEvent.click(dropZone!);

        await waitFor(() => {
          expect(mockApi.fileSystem.readBinaryFile).toHaveBeenCalledWith(mockPath);
          expect(mockApi.schema.scanZip).toHaveBeenCalled();
        });
      });

      it("displays file info after loading", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        // Filename should be displayed
        expect(screen.getByText("schema.xml")).toBeInTheDocument();
        // Line count should be displayed
        expect(screen.getByText(/lines/i)).toBeInTheDocument();
      });

      it("removes schema when remove button is clicked", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        // Find remove button by aria-label
        const removeButton = screen.getByLabelText("Remove schema");
        fireEvent.click(removeButton);

        await waitFor(() => {
          expect(useAppStore.getState().schemaPath).toBeNull();
        });
      });
    });

    describe("folder selection", () => {
      it("opens directory picker in folder mode", async () => {
        mockApi.fileSystem.openDirectoryPicker.mockResolvedValue(null);
        renderLeftPanel();
        await waitForDataLoad();

        // Switch to folder mode
        const segmentControl = document.querySelector(".mac-segment");
        const folderButton = within(segmentControl as HTMLElement).getAllByRole("button")[1];
        fireEvent.click(folderButton);

        const dropZone = screen.getByText(/select a folder/i).closest("button");
        fireEvent.click(dropZone!);

        await waitFor(() => {
          expect(mockApi.fileSystem.openDirectoryPicker).toHaveBeenCalled();
        });
      });

      it("scans folder and displays info", async () => {
        const mockPath = "/test/project";
        const mockTree = createMockSchemaTree({
          stats: { folders: 3, files: 5, downloads: 0 },
        });

        mockApi.fileSystem.openDirectoryPicker.mockResolvedValue(mockPath);
        mockApi.schema.scanFolder.mockResolvedValue(mockTree);
        mockApi.schema.exportSchemaXml.mockResolvedValue("<folder name=\"project\" />");
        mockApi.schema.extractVariables.mockResolvedValue([]);

        renderLeftPanel();
        await waitForDataLoad();

        // Switch to folder mode
        const segmentControl = document.querySelector(".mac-segment");
        const folderButton = within(segmentControl as HTMLElement).getAllByRole("button")[1];
        fireEvent.click(folderButton);

        const dropZone = screen.getByText(/select a folder/i).closest("button");
        fireEvent.click(dropZone!);

        await waitFor(() => {
          expect(mockApi.schema.scanFolder).toHaveBeenCalledWith(mockPath);
        });

        // Should display folder stats
        await waitFor(() => {
          expect(screen.getByText(/3 folders, 5 files/i)).toBeInTheDocument();
        });
      });

      it("shows Export as XML button for folder sources", async () => {
        const mockPath = "/test/project";
        const mockTree = createMockSchemaTree();

        mockApi.fileSystem.openDirectoryPicker.mockResolvedValue(mockPath);
        mockApi.schema.scanFolder.mockResolvedValue(mockTree);
        mockApi.schema.exportSchemaXml.mockResolvedValue("<folder name=\"project\" />");
        mockApi.schema.extractVariables.mockResolvedValue([]);

        renderLeftPanel();
        await waitForDataLoad();

        // Switch to folder mode and select folder
        const segmentControl = document.querySelector(".mac-segment");
        const folderButton = within(segmentControl as HTMLElement).getAllByRole("button")[1];
        fireEvent.click(folderButton);
        const dropZone = screen.getByText(/select a folder/i).closest("button");
        fireEvent.click(dropZone!);

        await waitFor(() => {
          expect(screen.getByText(/export as xml/i)).toBeInTheDocument();
        });
      });
    });
  });

  // ==========================================================================
  // Output Settings Section
  // ==========================================================================

  describe("Output Settings Section", () => {
    it("renders output folder input and browse button", async () => {
      renderLeftPanel();
      await waitForDataLoad();

      expect(screen.getByPlaceholderText(/select folder/i)).toBeInTheDocument();
      // Label is text, not associated with input
      expect(screen.getByText(/output folder/i)).toBeInTheDocument();
    });

    it("opens directory picker for output folder", async () => {
      mockApi.fileSystem.openDirectoryPicker.mockResolvedValue("/output/path");
      renderLeftPanel();
      await waitForDataLoad();

      // Find the browse button for output folder
      const outputSection = screen.getByText(/output folder/i).closest("div");
      const browseButton = within(outputSection!.parentElement!).getAllByRole("button")[0];
      fireEvent.click(browseButton);

      await waitFor(() => {
        expect(mockApi.fileSystem.openDirectoryPicker).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(useAppStore.getState().outputPath).toBe("/output/path");
      });
    });

    it("renders project name input", async () => {
      renderLeftPanel();
      await waitForDataLoad();

      const projectNameInput = screen.getByPlaceholderText("my-project");
      expect(projectNameInput).toBeInTheDocument();
    });

    it("updates project name on input", async () => {
      renderLeftPanel();
      await waitForDataLoad();

      const projectNameInput = screen.getByPlaceholderText("my-project");
      typeInInput(projectNameInput, "new-project");

      expect(useAppStore.getState().projectName).toBe("new-project");
    });
  });

  // ==========================================================================
  // Variables Section
  // ==========================================================================

  describe("Variables Section", () => {
    describe("variable display", () => {
      it("renders variables list", async () => {
        setupWithVariables([
          { name: "%PROJECT_NAME%", value: "my-project" },
          { name: "%VERSION%", value: "1.0.0" },
        ]);
        renderLeftPanel();
        await waitForDataLoad();

        expect(screen.getByText("%PROJECT_NAME%")).toBeInTheDocument();
        expect(screen.getByText("%VERSION%")).toBeInTheDocument();
      });

      it("displays variable values in inputs", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "my-project" }]);
        renderLeftPanel();
        await waitForDataLoad();

        const input = screen.getByDisplayValue("my-project");
        expect(input).toBeInTheDocument();
      });

      it("displays variable descriptions", async () => {
        setupWithVariables([
          { name: "%PROJECT_NAME%", value: "", description: "The name of your project" },
        ]);
        renderLeftPanel();
        await waitForDataLoad();

        expect(screen.getByText("The name of your project")).toBeInTheDocument();
      });

      it("displays validation errors", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "" }]);
        useAppStore.getState().setValidationErrors([
          { variable_name: "PROJECT_NAME", message: "Required field" },
        ]);
        renderLeftPanel();
        await waitForDataLoad();

        expect(screen.getByText("Required field")).toBeInTheDocument();
      });
    });

    describe("variable editing", () => {
      it("updates variable value on input", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "old-value" }]);
        renderLeftPanel();
        await waitForDataLoad();

        const input = screen.getByDisplayValue("old-value");
        typeInInput(input, "new-value");

        expect(useAppStore.getState().variables[0].value).toBe("new-value");
      });
    });

    describe("adding variables", () => {
      it("shows add variable form when plus button is clicked", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        const addButton = screen.getByTitle("Add variable");
        fireEvent.click(addButton);

        expect(screen.getByPlaceholderText("VARIABLE_NAME")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Value")).toBeInTheDocument();
      });

      it("adds new variable when form is submitted", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle("Add variable"));

        const nameInput = screen.getByPlaceholderText("VARIABLE_NAME");
        const valueInput = screen.getByPlaceholderText("Value");

        typeInInput(nameInput, "NEW_VAR");
        typeInInput(valueInput, "test-value");

        const addBtn = screen.getByRole("button", { name: /^add$/i });
        fireEvent.click(addBtn);

        const vars = useAppStore.getState().variables;
        expect(vars.some((v) => v.name === "%NEW_VAR%" || v.name === "NEW_VAR")).toBe(true);
      });

      it("converts variable name to uppercase", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle("Add variable"));

        const nameInput = screen.getByPlaceholderText("VARIABLE_NAME");
        typeInInput(nameInput, "lowercase");

        // Input should show uppercase (the component transforms on change)
        expect(nameInput).toHaveValue("LOWERCASE");
      });

      it("removes invalid characters from variable name", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle("Add variable"));

        const nameInput = screen.getByPlaceholderText("VARIABLE_NAME");
        typeInInput(nameInput, "test@#$_var");

        // Only valid chars should remain (letters and underscore, converted to uppercase)
        expect(nameInput).toHaveValue("TEST_VAR");
      });

      it("cancels adding variable", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle("Add variable"));
        expect(screen.getByPlaceholderText("VARIABLE_NAME")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

        expect(screen.queryByPlaceholderText("VARIABLE_NAME")).not.toBeInTheDocument();
      });
    });

    describe("removing variables", () => {
      it("removes variable when remove button is clicked", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "test" }]);
        renderLeftPanel();
        await waitForDataLoad();

        // Find the remove button (appears on hover)
        const variableContainer = screen.getByText("%PROJECT_NAME%").closest("div");
        const removeButton = within(variableContainer!.parentElement!).getByTitle("Remove variable");
        fireEvent.click(removeButton);

        expect(useAppStore.getState().variables).toHaveLength(0);
      });
    });

    describe("validation configuration popover", () => {
      it("opens validation popover when settings button is clicked", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "test" }]);
        renderLeftPanel();
        await waitForDataLoad();

        const settingsButton = screen.getByLabelText(/configure validation for %PROJECT_NAME%/i);
        fireEvent.click(settingsButton);

        expect(screen.getByText("Validation Rules")).toBeInTheDocument();
        expect(screen.getByLabelText(/required/i)).toBeInTheDocument();
      });

      it("toggles required checkbox", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "test" }]);
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByLabelText(/configure validation for %PROJECT_NAME%/i));

        const requiredCheckbox = screen.getByRole("checkbox");
        fireEvent.click(requiredCheckbox);

        expect(useAppStore.getState().variables[0].validation?.required).toBe(true);
      });

      it("closes popover when Done is clicked", async () => {
        setupWithVariables([{ name: "%PROJECT_NAME%", value: "test" }]);
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByLabelText(/configure validation for %PROJECT_NAME%/i));
        expect(screen.getByText("Validation Rules")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /done/i }));

        expect(screen.queryByText("Validation Rules")).not.toBeInTheDocument();
      });
    });

    describe("transformation help toggle", () => {
      it("shows transformation help when toggle is clicked", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        const helpToggle = screen.getByRole("button", { name: /available transformations/i });
        fireEvent.click(helpToggle);

        expect(screen.getByText(/case transformations/i)).toBeInTheDocument();
        expect(screen.getByText(":uppercase")).toBeInTheDocument();
        expect(screen.getByText(":lowercase")).toBeInTheDocument();
      });

      it("hides transformation help when clicked again", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        const helpToggle = screen.getByRole("button", { name: /available transformations/i });
        fireEvent.click(helpToggle);
        expect(screen.getByText(/case transformations/i)).toBeInTheDocument();

        fireEvent.click(helpToggle);
        expect(screen.queryByText(/case transformations/i)).not.toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Templates Section
  // ==========================================================================

  describe("Templates Section", () => {
    describe("initial state", () => {
      it("shows loading state initially", async () => {
        useAppStore.getState().setTemplatesLoading(true);
        renderLeftPanel();

        expect(screen.getByText(/loading templates/i)).toBeInTheDocument();
      });

      it("shows empty state when no templates", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
      });

      it("renders template list when templates exist", async () => {
        const templates = [
          createMockTemplate({ name: "React Component" }),
          createMockTemplate({ name: "Node API" }),
        ];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("React Component")).toBeInTheDocument();
          expect(screen.getByText("Node API")).toBeInTheDocument();
        });
      });
    });

    describe("search and filtering", () => {
      beforeEach(() => {
        const templates = [
          createMockTemplate({ name: "React Component", tags: ["react", "frontend"] }),
          createMockTemplate({ name: "Node API", tags: ["node", "backend"] }),
          createMockTemplate({ name: "React Native App", tags: ["react", "mobile"] }),
        ];
        mockApi.database.listTemplates.mockResolvedValue(templates);
      });

      it("filters templates by search query", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("React Component")).toBeInTheDocument();
        });

        const searchInput = screen.getByPlaceholderText(/search templates/i);
        typeInInput(searchInput, "Node");

        // Wait for debounce
        await waitFor(() => {
          expect(screen.queryByText("React Component")).not.toBeInTheDocument();
          expect(screen.getByText("Node API")).toBeInTheDocument();
        }, { timeout: 500 });
      });

      it("shows clear button when search has value", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("React Component")).toBeInTheDocument();
        });

        const searchInput = screen.getByPlaceholderText(/search templates/i);
        typeInInput(searchInput, "test");

        // Wait for clear button to appear after input change
        await waitFor(() => {
          expect(screen.getByLabelText("Clear search")).toBeInTheDocument();
        });

        const clearButton = screen.getByLabelText("Clear search");
        fireEvent.click(clearButton);
        expect(searchInput).toHaveValue("");
      });
    });

    describe("sorting", () => {
      it("renders sort dropdown with all options", async () => {
        const templates = [createMockTemplate()];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Test Template")).toBeInTheDocument();
        });

        // Wait for sort dropdown to be available (it only shows when templates exist)
        await waitFor(() => {
          expect(screen.getByLabelText("Sort templates")).toBeInTheDocument();
        });

        const sortSelect = screen.getByLabelText("Sort templates");

        // Check options exist
        const options = within(sortSelect).getAllByRole("option");
        expect(options.length).toBeGreaterThan(1);
        expect(options.some((o) => o.textContent === "Default")).toBe(true);
        expect(options.some((o) => o.textContent === "Name A-Z")).toBe(true);
        expect(options.some((o) => o.textContent === "Most Used")).toBe(true);
      });

      it("changes sort option", async () => {
        const templates = [createMockTemplate()];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Test Template")).toBeInTheDocument();
        });

        // Wait for sort dropdown to be available
        await waitFor(() => {
          expect(screen.getByLabelText("Sort templates")).toBeInTheDocument();
        });

        const sortSelect = screen.getByLabelText("Sort templates");
        fireEvent.change(sortSelect, { target: { value: "name_asc" } });

        expect(useAppStore.getState().templateSortOption).toBe("name_asc");
      });
    });

    describe("tag filtering", () => {
      it("adds tag filter when tag is clicked", async () => {
        const templates = [
          createMockTemplate({ name: "React App", tags: ["react", "frontend"] }),
        ];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("React App")).toBeInTheDocument();
        });

        // Wait for the tag buttons to be rendered
        await waitFor(() => {
          expect(screen.getByLabelText("Filter by tag: react")).toBeInTheDocument();
        });

        const tagButton = screen.getByLabelText("Filter by tag: react");
        fireEvent.click(tagButton);

        expect(useAppStore.getState().templateFilterTags).toContain("react");
      });

      it("removes tag filter when filter tag is clicked", async () => {
        const templates = [
          createMockTemplate({ name: "React App", tags: ["react"] }),
        ];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        useAppStore.getState().addTemplateFilterTag("react");
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("React App")).toBeInTheDocument();
        });

        // Wait for the remove filter button to appear (it has aria-label)
        await waitFor(() => {
          expect(screen.getByLabelText("Remove react filter")).toBeInTheDocument();
        });

        // Find the filter tag remove button by its aria-label
        const removeButton = screen.getByLabelText("Remove react filter");
        fireEvent.click(removeButton);

        expect(useAppStore.getState().templateFilterTags).not.toContain("react");
      });

      it("clears all filters when Clear all is clicked", async () => {
        const templates = [createMockTemplate({ tags: ["react"] })];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        useAppStore.getState().addTemplateFilterTag("react");
        useAppStore.getState().addTemplateFilterTag("frontend");
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          const clearAllButton = screen.getByText("Clear all");
          return expect(clearAllButton).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText("Clear all"));

        expect(useAppStore.getState().templateFilterTags).toHaveLength(0);
      });
    });

    describe("template loading", () => {
      it("loads template when clicked", async () => {
        const template = createMockTemplate({
          name: "My Template",
          schema_xml: "<folder name=\"test\" />",
          variables: { "%NAME%": "default" },
        });
        mockApi.database.listTemplates.mockResolvedValue([template]);
        mockApi.schema.parseSchemaWithInheritance.mockResolvedValue(createMockParseResult());
        mockApi.schema.extractVariables.mockResolvedValue(["%NAME%"]);
        mockApi.database.incrementUseCount.mockResolvedValue(undefined);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("My Template")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByText("My Template"));

        await waitFor(() => {
          expect(mockApi.database.incrementUseCount).toHaveBeenCalledWith(template.id);
          expect(mockApi.schema.parseSchemaWithInheritance).toHaveBeenCalled();
        });
      });

      it("opens wizard for templates with wizard config", async () => {
        const template = createMockTemplate({
          name: "Wizard Template",
          wizard_config: {
            title: "Setup Wizard",
            steps: [{ id: "step1", title: "Step 1", questions: [] }],
            schemaModifiers: [],
          },
        });
        mockApi.database.listTemplates.mockResolvedValue([template]);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Wizard Template")).toBeInTheDocument();
        });

        // Should show wizard badge
        expect(screen.getByText("Wizard")).toBeInTheDocument();

        fireEvent.click(screen.getByText("Wizard Template"));

        // Should open wizard (calls openWizard)
        await waitFor(() => {
          expect(useAppStore.getState().wizardState?.isOpen).toBe(true);
          expect(useAppStore.getState().wizardState?.template?.id).toBe(template.id);
        });
      });
    });

    describe("template actions", () => {
      it("toggles favorite when star is clicked", async () => {
        const template = createMockTemplate({ is_favorite: false });
        mockApi.database.listTemplates.mockResolvedValue([template]);
        mockApi.database.toggleFavorite.mockResolvedValue(undefined);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Test Template")).toBeInTheDocument();
        });

        // Hover to show actions
        const templateCard = screen.getByText("Test Template").closest('[role="option"]');
        fireEvent.mouseEnter(templateCard!);

        const favoriteButton = screen.getByLabelText(/add to favorites/i);
        fireEvent.click(favoriteButton);

        await waitFor(() => {
          expect(mockApi.database.toggleFavorite).toHaveBeenCalledWith(template.id);
        });
      });

      it("deletes template when delete is clicked", async () => {
        const template = createMockTemplate();
        mockApi.database.listTemplates.mockResolvedValue([template]);
        mockApi.database.deleteTemplate.mockResolvedValue(true);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Test Template")).toBeInTheDocument();
        });

        const templateCard = screen.getByText("Test Template").closest('[role="option"]');
        fireEvent.mouseEnter(templateCard!);

        const deleteButton = screen.getByLabelText("Delete template");
        fireEvent.click(deleteButton);

        await waitFor(() => {
          expect(mockApi.database.deleteTemplate).toHaveBeenCalledWith(template.id);
        });
      });

      it("opens export modal when export is clicked", async () => {
        const template = createMockTemplate();
        const onImportExportModalChange = vi.fn();
        mockApi.database.listTemplates.mockResolvedValue([template]);
        renderLeftPanel({ onImportExportModalChange });
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Test Template")).toBeInTheDocument();
        });

        const templateCard = screen.getByText("Test Template").closest('[role="option"]');
        fireEvent.mouseEnter(templateCard!);

        const exportButton = screen.getByLabelText("Export template");
        fireEvent.click(exportButton);

        await waitFor(() => {
          expect(screen.getByRole("dialog")).toBeInTheDocument();
          expect(screen.getByText("Export Templates")).toBeInTheDocument();
        });
      });
    });

    describe("save template form", () => {
      it("shows save template button when schema is loaded", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        const saveButton = screen.getByTitle(/save as template/i);
        expect(saveButton).toBeInTheDocument();
      });

      it("opens save form when save button is clicked", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle(/save as template/i));

        expect(screen.getByPlaceholderText("Template name")).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/description/i)).toBeInTheDocument();
      });

      it("saves template with name, description, and tags", async () => {
        setupWithSchema();
        mockApi.database.createTemplate.mockResolvedValue(createMockTemplate());
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle(/save as template/i));

        typeInInput(screen.getByPlaceholderText("Template name"), "My New Template");
        typeInInput(screen.getByPlaceholderText(/description/i), "A great template");

        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await waitFor(() => {
          expect(mockApi.database.createTemplate).toHaveBeenCalledWith(
            expect.objectContaining({
              name: "My New Template",
              description: "A great template",
            })
          );
        });
      });

      it("cancels save form", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle(/save as template/i));
        expect(screen.getByPlaceholderText("Template name")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

        expect(screen.queryByPlaceholderText("Template name")).not.toBeInTheDocument();
      });

      it("disables save button when name is empty", async () => {
        setupWithSchema();
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle(/save as template/i));

        const saveButton = screen.getByRole("button", { name: /^save$/i });
        expect(saveButton).toBeDisabled();
      });
    });

    describe("import/export buttons", () => {
      it("shows import button", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        expect(screen.getByTitle("Import templates")).toBeInTheDocument();
      });

      it("opens import modal when import button is clicked", async () => {
        renderLeftPanel();
        await waitForDataLoad();

        fireEvent.click(screen.getByTitle("Import templates"));

        await waitFor(() => {
          expect(screen.getByRole("dialog")).toBeInTheDocument();
          expect(screen.getByText("Import Templates")).toBeInTheDocument();
        });
      });

      it("shows export button when templates exist", async () => {
        const templates = [createMockTemplate()];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByTitle("Export templates")).toBeInTheDocument();
        });
      });

      it("opens bulk export modal when export button is clicked", async () => {
        const templates = [createMockTemplate()];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByTitle("Export templates")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByTitle("Export templates"));

        await waitFor(() => {
          expect(screen.getByRole("dialog")).toBeInTheDocument();
          expect(screen.getByText("Export Templates")).toBeInTheDocument();
        });
      });
    });

    describe("keyboard navigation", () => {
      it("navigates templates with arrow keys", async () => {
        const templates = [
          createMockTemplate({ name: "Template 1" }),
          createMockTemplate({ name: "Template 2" }),
          createMockTemplate({ name: "Template 3" }),
        ];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Template 1")).toBeInTheDocument();
        });

        // Wait for listbox to be rendered
        await waitFor(() => {
          expect(screen.getByRole("listbox")).toBeInTheDocument();
        });

        // Focus the template list - this triggers onFocus which sets focusedTemplateIndex to 0
        const templateList = screen.getByRole("listbox");
        act(() => {
          templateList.focus();
        });

        // After focus, first item should be selected
        await waitFor(() => {
          const template1 = screen.getByText("Template 1").closest('[role="option"]');
          expect(template1).toHaveAttribute("aria-selected", "true");
        });

        // Arrow down to second item
        fireEvent.keyDown(templateList, { key: "ArrowDown" });

        await waitFor(() => {
          const template2 = screen.getByText("Template 2").closest('[role="option"]');
          expect(template2).toHaveAttribute("aria-selected", "true");
        });

        // Arrow down to third item
        fireEvent.keyDown(templateList, { key: "ArrowDown" });

        await waitFor(() => {
          const template3 = screen.getByText("Template 3").closest('[role="option"]');
          expect(template3).toHaveAttribute("aria-selected", "true");
        });
      });

      it("navigates to first item with Home key", async () => {
        const templates = [
          createMockTemplate({ name: "Template 1" }),
          createMockTemplate({ name: "Template 2" }),
          createMockTemplate({ name: "Template 3" }),
        ];
        mockApi.database.listTemplates.mockResolvedValue(templates);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Template 1")).toBeInTheDocument();
        });

        const templateList = screen.getByRole("listbox");
        act(() => {
          templateList.focus();
        });

        // Go to last
        fireEvent.keyDown(templateList, { key: "End" });

        await waitFor(() => {
          const template3 = screen.getByText("Template 3").closest('[role="option"]');
          expect(template3).toHaveAttribute("aria-selected", "true");
        });

        // Go to first
        fireEvent.keyDown(templateList, { key: "Home" });

        await waitFor(() => {
          const template1 = screen.getByText("Template 1").closest('[role="option"]');
          expect(template1).toHaveAttribute("aria-selected", "true");
        });
      });

      it("loads template with Enter key", async () => {
        const template = createMockTemplate({ name: "Template 1" });
        mockApi.database.listTemplates.mockResolvedValue([template]);
        mockApi.schema.parseSchemaWithInheritance.mockResolvedValue(createMockParseResult());
        mockApi.schema.extractVariables.mockResolvedValue([]);
        mockApi.database.incrementUseCount.mockResolvedValue(undefined);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Template 1")).toBeInTheDocument();
        });

        const templateList = screen.getByRole("listbox");
        act(() => {
          templateList.focus();
        });

        fireEvent.keyDown(templateList, { key: "ArrowDown" });
        fireEvent.keyDown(templateList, { key: "Enter" });

        await waitFor(() => {
          expect(mockApi.database.incrementUseCount).toHaveBeenCalled();
        });
      });

      it("loads template with Space key", async () => {
        const template = createMockTemplate({ name: "Template 1" });
        mockApi.database.listTemplates.mockResolvedValue([template]);
        mockApi.schema.parseSchemaWithInheritance.mockResolvedValue(createMockParseResult());
        mockApi.schema.extractVariables.mockResolvedValue([]);
        mockApi.database.incrementUseCount.mockResolvedValue(undefined);
        renderLeftPanel();
        await waitForDataLoad();

        await waitFor(() => {
          expect(screen.getByText("Template 1")).toBeInTheDocument();
        });

        const templateList = screen.getByRole("listbox");
        act(() => {
          templateList.focus();
        });

        fireEvent.keyDown(templateList, { key: "ArrowDown" });
        fireEvent.keyDown(templateList, { key: " " });

        await waitFor(() => {
          expect(mockApi.database.incrementUseCount).toHaveBeenCalled();
        });
      });
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe("Integration", () => {
    it("complete workflow: load file, set variables, save as template", async () => {
      const mockPath = "/test/schema.xml";
      const mockContent = "<folder name=\"%PROJECT%\"><file name=\"%FILE%.ts\" /></folder>";
      const mockTree = createMockSchemaTree();

      mockApi.fileSystem.openFilePicker.mockResolvedValue(mockPath);
      mockApi.fileSystem.readTextFile.mockResolvedValue(mockContent);
      mockApi.schema.parseSchemaWithInheritance.mockResolvedValue(createMockParseResult(mockTree));
      mockApi.schema.extractVariables.mockResolvedValue(["%PROJECT%", "%FILE%"]);
      mockApi.database.createTemplate.mockResolvedValue(createMockTemplate());

      renderLeftPanel();
      await waitForDataLoad();

      // 1. Load file
      const dropZone = screen.getByText(/select schema file/i).closest("button");
      fireEvent.click(dropZone!);

      await waitFor(() => {
        expect(mockApi.schema.parseSchemaWithInheritance).toHaveBeenCalled();
      });

      // 2. Set variables
      await waitFor(() => {
        expect(useAppStore.getState().variables.length).toBeGreaterThan(0);
      });

      // Find a variable input and update it
      const state = useAppStore.getState();
      if (state.variables.length > 0) {
        act(() => {
          useAppStore.getState().updateVariable(state.variables[0].name, "my-value");
        });
      }

      // 3. Save as template
      fireEvent.click(screen.getByTitle(/save as template/i));
      typeInInput(screen.getByPlaceholderText("Template name"), "My Project Template");
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await waitFor(() => {
        expect(mockApi.database.createTemplate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "My Project Template",
            schemaXml: mockContent,
          })
        );
      });
    });

    it("renders child sections when data exists", async () => {
      // Mock recent projects to make RecentProjectsSection render
      mockApi.database.listRecentProjects.mockResolvedValue([
        {
          id: "1",
          projectName: "Test Project",
          outputPath: "/test/output",
          schemaXml: "<folder name=\"test\" />",
          variables: {},
          variableValidation: {},
          templateId: null,
          templateName: null,
          foldersCreated: 1,
          filesCreated: 2,
          createdAt: new Date().toISOString(),
        },
      ]);

      renderLeftPanel();
      await waitForDataLoad();

      // Recent Projects section renders when there are recent projects
      await waitFor(() => {
        expect(screen.getByText("Recent Projects")).toBeInTheDocument();
      });
      // TeamLibrariesSection returns null in non-desktop/web mode (jsdom), so we don't check for it
    });

    it("notifies parent when import/export modal opens", async () => {
      const onImportExportModalChange = vi.fn();
      renderLeftPanel({ onImportExportModalChange });
      await waitForDataLoad();

      fireEvent.click(screen.getByTitle("Import templates"));

      await waitFor(() => {
        expect(onImportExportModalChange).toHaveBeenCalledWith(true);
      });
    });

    it("notifies parent when import/export modal closes", async () => {
      const onImportExportModalChange = vi.fn();
      renderLeftPanel({ onImportExportModalChange });
      await waitForDataLoad();

      fireEvent.click(screen.getByTitle("Import templates"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Close the modal using the close button
      fireEvent.click(screen.getByLabelText("Close modal"));

      await waitFor(() => {
        expect(onImportExportModalChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
