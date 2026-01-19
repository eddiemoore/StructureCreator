import { FolderPlusIcon, GridIcon, SettingsIcon } from "./Icons";

export const Header = () => {
  return (
    <header className="col-span-full bg-bg-primary px-6 py-4 flex items-center justify-between border-b border-border-default">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-cyan-primary to-cyan-dim rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.15)]">
          <FolderPlusIcon size={20} className="text-bg-deep" />
        </div>
        <span className="text-lg font-semibold tracking-tight">
          Structure<span className="text-cyan-primary">Creator</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-bg-secondary border border-border-default rounded-md hover:bg-bg-tertiary hover:border-cyan-muted transition-all">
          <GridIcon size={16} />
          Templates
        </button>
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-bg-secondary border border-border-default rounded-md hover:bg-bg-tertiary hover:border-cyan-muted transition-all">
          <SettingsIcon size={16} />
          Settings
        </button>
      </div>
    </header>
  );
};
