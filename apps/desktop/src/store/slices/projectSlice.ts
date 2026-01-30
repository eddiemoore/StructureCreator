import type { StateCreator } from "zustand";
import type { RecentProject } from "../../types/schema";

export interface ProjectSlice {
  outputPath: string | null;
  projectName: string;
  recentProjects: RecentProject[];
  recentProjectsLoading: boolean;
  setOutputPath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  setRecentProjects: (projects: RecentProject[]) => void;
  setRecentProjectsLoading: (loading: boolean) => void;
}

export const createProjectSlice: StateCreator<ProjectSlice, [], [], ProjectSlice> = (set) => ({
  outputPath: null,
  projectName: "my-project",
  recentProjects: [],
  recentProjectsLoading: false,

  setOutputPath: (outputPath) => set({ outputPath }),

  setProjectName: (projectName) => set({ projectName }),

  setRecentProjects: (recentProjects) => set({ recentProjects }),

  setRecentProjectsLoading: (recentProjectsLoading) => set({ recentProjectsLoading }),
});
