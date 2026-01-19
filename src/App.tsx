import { Header } from "./components/Header";
import { LeftPanel } from "./components/LeftPanel";
import { TreePreview } from "./components/TreePreview";
import { RightPanel } from "./components/RightPanel";
import { Footer } from "./components/Footer";

function App() {
  return (
    <div className="bg-mac-bg min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 grid grid-cols-[280px_1fr_300px] border-t border-border-muted">
        <LeftPanel />
        <TreePreview />
        <RightPanel />
      </div>
      <Footer />
    </div>
  );
}

export default App;
