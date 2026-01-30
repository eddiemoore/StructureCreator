import type { StateCreator } from "zustand";
import type { Template, TemplateSortOption } from "../../types/schema";

export interface TemplatesSlice {
  templates: Template[];
  templatesLoading: boolean;
  templateSearchQuery: string;
  templateFilterTags: string[];
  templateSortOption: TemplateSortOption;
  allTags: string[];
  setTemplates: (templates: Template[]) => void;
  setTemplatesLoading: (loading: boolean) => void;
  setTemplateSearchQuery: (query: string) => void;
  setTemplateFilterTags: (tags: string[]) => void;
  addTemplateFilterTag: (tag: string) => void;
  removeTemplateFilterTag: (tag: string) => void;
  clearTemplateFilters: () => void;
  setTemplateSortOption: (option: TemplateSortOption) => void;
  setAllTags: (tags: string[]) => void;
  getFilteredTemplates: () => Template[];
}

export const createTemplatesSlice: StateCreator<TemplatesSlice, [], [], TemplatesSlice> = (set, get) => ({
  templates: [],
  templatesLoading: false,
  templateSearchQuery: "",
  templateFilterTags: [],
  templateSortOption: "default",
  allTags: [],

  setTemplates: (templates) => set({ templates }),

  setTemplatesLoading: (templatesLoading) => set({ templatesLoading }),

  setTemplateSearchQuery: (templateSearchQuery) => set({ templateSearchQuery }),

  setTemplateFilterTags: (templateFilterTags) => set({ templateFilterTags }),

  addTemplateFilterTag: (tag) =>
    set((state) => ({
      templateFilterTags: state.templateFilterTags.includes(tag)
        ? state.templateFilterTags
        : [...state.templateFilterTags, tag],
    })),

  removeTemplateFilterTag: (tag) =>
    set((state) => ({
      templateFilterTags: state.templateFilterTags.filter((t) => t !== tag),
    })),

  clearTemplateFilters: () =>
    set({
      templateSearchQuery: "",
      templateFilterTags: [],
      templateSortOption: "default",
    }),

  setTemplateSortOption: (templateSortOption) =>
    set({ templateSortOption }),

  setAllTags: (allTags) => set({ allTags }),

  getFilteredTemplates: () => {
    const state = get();

    // Short-circuit if no filters are active
    const hasSearch = state.templateSearchQuery.trim() !== "";
    const hasTagFilter = state.templateFilterTags.length > 0;
    const hasSort = state.templateSortOption !== "default";

    if (!hasSearch && !hasTagFilter && !hasSort) {
      return state.templates;
    }

    let filtered = [...state.templates];

    // Apply search filter (searches name, description, and tags)
    // Note: tags are already stored lowercase, so no need to call toLowerCase() on them
    if (hasSearch) {
      const query = state.templateSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.description && t.description.toLowerCase().includes(query)) ||
          t.tags.some((tag) => tag.includes(query))
      );
    }

    // Apply tag filter (AND logic - template must have all selected tags)
    if (hasTagFilter) {
      filtered = filtered.filter((t) =>
        state.templateFilterTags.every((tag) => t.tags.includes(tag))
      );
    }

    // Apply sorting
    switch (state.templateSortOption) {
      case "name_asc":
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name_desc":
        filtered.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "created_asc":
        filtered.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "created_desc":
        filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case "updated_asc":
        filtered.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
        break;
      case "updated_desc":
        filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        break;
      case "usage_asc":
        filtered.sort((a, b) => a.use_count - b.use_count);
        break;
      case "usage_desc":
        filtered.sort((a, b) => b.use_count - a.use_count);
        break;
      default:
        // Default: favorites first, then by use count, then by updated date
        // This is already the order from the database
        break;
    }

    return filtered;
  },
});
