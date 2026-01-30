import type { StateCreator } from "zustand";
import type { TeamLibrary, TeamTemplate } from "../../types/schema";

export interface TeamSlice {
  teamLibraries: TeamLibrary[];
  teamLibrariesLoading: boolean;
  activeTeamLibrary: string | null;
  teamTemplates: TeamTemplate[];
  teamTemplatesLoading: boolean;
  setTeamLibraries: (libraries: TeamLibrary[]) => void;
  setTeamLibrariesLoading: (loading: boolean) => void;
  setActiveTeamLibrary: (id: string | null) => void;
  setTeamTemplates: (templates: TeamTemplate[]) => void;
  setTeamTemplatesLoading: (loading: boolean) => void;
}

export const createTeamSlice: StateCreator<TeamSlice, [], [], TeamSlice> = (set) => ({
  teamLibraries: [],
  teamLibrariesLoading: false,
  activeTeamLibrary: null,
  teamTemplates: [],
  teamTemplatesLoading: false,

  setTeamLibraries: (teamLibraries) => set({ teamLibraries }),

  setTeamLibrariesLoading: (teamLibrariesLoading) => set({ teamLibrariesLoading }),

  setActiveTeamLibrary: (activeTeamLibrary) => set({ activeTeamLibrary }),

  setTeamTemplates: (teamTemplates) => set({ teamTemplates }),

  setTeamTemplatesLoading: (teamTemplatesLoading) => set({ teamTemplatesLoading }),
});
