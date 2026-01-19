import { Header } from "./components/Header";
import { LeftPanel } from "./components/LeftPanel";
import { TreePreview } from "./components/TreePreview";
import { RightPanel } from "./components/RightPanel";
import { Footer } from "./components/Footer";

function App() {
  return (
    <>
      <div className="blueprint-grid" />
      <div className="relative z-10 grid grid-cols-[300px_1fr_320px] grid-rows-[auto_1fr_auto] min-h-screen gap-px bg-border-muted">
        <Header />
        <LeftPanel />
        <TreePreview />
        <RightPanel />
        <Footer />
      </div>
    </>
  );
}

export default App;
