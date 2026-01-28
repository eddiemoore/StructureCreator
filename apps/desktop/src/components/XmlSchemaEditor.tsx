import { useCallback, useRef, useEffect } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Extension } from "@codemirror/state";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { useAppStore } from "../store/appStore";
import { AlertCircleIcon } from "./Icons";

export const XmlSchemaEditor = () => {
  const {
    xmlEditorContent,
    xmlParseError,
    setXmlEditorContent,
    setXmlParseError,
    syncXmlToTree,
  } = useAppStore();

  const editorRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInternalChangeRef = useRef(false);

  // Debounced validation - validates XML as user types
  const validateXml = useCallback((content: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      // Simple XML validation - try to parse
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, "text/xml");
        const parseError = doc.querySelector("parsererror");
        if (parseError) {
          // Extract error message from parsererror element
          const errorText = parseError.textContent || "XML parsing error";
          setXmlParseError(errorText);
        } else {
          setXmlParseError(null);
        }
      } catch {
        setXmlParseError("Invalid XML syntax");
      }
    }, 500);
  }, [setXmlParseError]);

  // Format XML with proper indentation
  const formatXml = useCallback(() => {
    if (!viewRef.current || !xmlEditorContent) return;

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlEditorContent, "text/xml");
      const parseError = doc.querySelector("parsererror");

      if (parseError) {
        // Don't format if there's a parse error
        return;
      }

      // Format the XML
      const serializer = new XMLSerializer();
      let formatted = serializer.serializeToString(doc);

      // Add proper indentation
      formatted = formatXmlString(formatted);

      // Update editor content
      isInternalChangeRef.current = true;
      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: formatted,
        },
      });
      viewRef.current.dispatch(transaction);
      setXmlEditorContent(formatted);
      setXmlParseError(null);
      isInternalChangeRef.current = false;
    } catch {
      // Silently fail - user will see parse error
    }
  }, [xmlEditorContent, setXmlEditorContent, setXmlParseError]);

  // Create CodeMirror extensions
  const createExtensions = useCallback((): Extension[] => {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      xml(),
      oneDark,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isInternalChangeRef.current) {
          const content = update.state.doc.toString();
          setXmlEditorContent(content);
          validateXml(content);
        }
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: "13px",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        },
        ".cm-content": {
          padding: "8px 0",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRight: "1px solid var(--color-border-muted)",
        },
      }),
    ];
  }, [setXmlEditorContent, validateXml]);

  // Initialize CodeMirror editor using ref callback
  const initEditor = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      // Cleanup on unmount
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      return;
    }

    // Don't re-initialize if we already have a view for this node
    if (viewRef.current && editorRef.current === node) {
      return;
    }

    editorRef.current = node;

    // Get content from store at initialization time
    const content = useAppStore.getState().xmlEditorContent || "";

    const state = EditorState.create({
      doc: content,
      extensions: createExtensions(),
    });

    viewRef.current = new EditorView({
      state,
      parent: node,
    });
  }, [createExtensions]);

  // Sync external content changes to editor (when content is set externally, not from typing)
  useEffect(() => {
    if (!viewRef.current || isInternalChangeRef.current) return;

    const currentContent = viewRef.current.state.doc.toString();
    const newContent = xmlEditorContent || "";

    // Only update if the content is actually different (avoids infinite loops)
    if (currentContent !== newContent) {
      isInternalChangeRef.current = true;
      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: newContent,
        },
      });
      viewRef.current.dispatch(transaction);
      isInternalChangeRef.current = false;
    }
  }, [xmlEditorContent]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Sync button handler
  const handleSync = useCallback(async () => {
    const success = await syncXmlToTree();
    if (success) {
      setXmlParseError(null);
    }
  }, [syncXmlToTree, setXmlParseError]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border-muted flex items-center gap-2 bg-mac-bg">
        <button
          onClick={formatXml}
          disabled={!!xmlParseError}
          className="px-2.5 py-1 text-mac-xs rounded-mac bg-mac-bg-secondary hover:bg-mac-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Format XML"
        >
          Format
        </button>
        <button
          onClick={handleSync}
          disabled={!!xmlParseError}
          className="px-2.5 py-1 text-mac-xs rounded-mac bg-mac-bg-secondary hover:bg-mac-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Sync changes to tree"
        >
          Apply Changes
        </button>
        <div className="flex-1" />
        <span className="text-mac-xs text-text-muted">
          Edit XML directly
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <div ref={initEditor} className="h-full" />
      </div>

      {/* Error banner */}
      {xmlParseError && (
        <div className="px-3 py-2 bg-system-red/10 border-t border-system-red/20 flex items-start gap-2">
          <AlertCircleIcon size={16} className="text-system-red flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-mac-xs font-medium text-system-red">XML Parse Error</div>
            <div className="text-mac-xs text-system-red/80 truncate" title={xmlParseError}>
              {xmlParseError.split("\n")[0]}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper function to format XML with proper indentation
function formatXmlString(xml: string): string {
  const PADDING = "  ";
  let formatted = "";
  let indent = 0;

  // Split on tags, keeping them in the result
  const parts = xml.replace(/></g, ">\n<").split("\n");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check if this is a closing tag
    const isClosing = trimmed.startsWith("</");
    // Check if this is a self-closing tag
    const isSelfClosing = trimmed.endsWith("/>");
    // Check if this is a processing instruction or declaration
    const isDeclaration = trimmed.startsWith("<?");

    if (isClosing && !isSelfClosing) {
      indent = Math.max(0, indent - 1);
    }

    formatted += PADDING.repeat(indent) + trimmed + "\n";

    if (!isClosing && !isSelfClosing && !isDeclaration && !trimmed.includes("</")) {
      indent++;
    }
  }

  return formatted.trim();
}
