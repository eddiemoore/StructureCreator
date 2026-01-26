import type { Template, SchemaNode } from '@structure-creator/shared';

function App() {
  // Example usage of shared types
  const exampleTemplate: Partial<Template> = {
    name: 'Example Template',
    description: 'A sample template',
  };

  const exampleNode: SchemaNode = {
    type: 'folder',
    name: 'src',
    children: [
      { type: 'file', name: 'index.ts' },
    ],
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-800">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">Structure Creator</h1>
          <p className="text-gray-400 mt-2">
            Generate folder and file structures from XML schemas
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <section className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-semibold mb-4">Coming Soon</h2>
          <p className="text-gray-400 mb-8">
            The Structure Creator website is under development. For now, download
            the desktop application to get started.
          </p>

          <div className="bg-gray-800 rounded-lg p-6 text-left">
            <h3 className="font-semibold mb-2">Desktop App Features:</h3>
            <ul className="text-gray-400 space-y-2">
              <li>• Create folder/file structures from XML schemas</li>
              <li>• Variable substitution with transformations</li>
              <li>• Template library with import/export</li>
              <li>• Template wizard for guided setup</li>
              <li>• Watch mode for live reloading</li>
            </ul>
          </div>

          {/* Demo of shared types being used */}
          <div className="mt-8 text-sm text-gray-500">
            <p>Shared types loaded: Template, SchemaNode</p>
            <p>Example template: {exampleTemplate.name}</p>
            <p>Example node: {exampleNode.type}/{exampleNode.name}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-800 mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-gray-500">
          <p>&copy; 2024 Structure Creator</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
