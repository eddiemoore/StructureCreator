import { FolderPlusIcon, GridIcon, SettingsIcon } from "./Icons";

export const Header = () => {
  return (
    <header className="bg-mac-bg-secondary px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-system-blue rounded-mac flex items-center justify-center">
          <FolderPlusIcon size={18} className="text-white" />
        </div>
        <span className="text-mac-lg font-semibold text-text-primary">
          Structure Creator
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button className="mac-button-secondary flex items-center gap-2 text-mac-base">
          <GridIcon size={16} className="text-text-secondary" />
          Templates
        </button>
        <button className="mac-button-secondary flex items-center gap-2 text-mac-base">
          <SettingsIcon size={16} className="text-text-secondary" />
          Settings
        </button>
      </div>
    </header>
  );
};
