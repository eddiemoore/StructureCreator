/**
 * Simple markdown parser for release notes.
 * Handles basic GitHub-flavored markdown without external dependencies.
 */

/**
 * Escapes HTML special characters to prevent XSS
 */
const escapeHtml = (text: string): string => {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
};

/**
 * Converts basic markdown to HTML for display in release notes.
 * Supports: headers, bold, italic, links, inline code, bullet lists.
 */
export const parseMarkdown = (markdown: string): string => {
  if (!markdown) return "";

  let html = escapeHtml(markdown);

  // Headers (## Header)
  html = html.replace(/^### (.+)$/gm, '<strong class="text-mac-sm">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong class="text-mac-sm">$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong class="text-mac-base">$1</strong>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic (*text* or _text_) - be careful not to match already processed bold
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");

  // Inline code (`code`)
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="bg-border-muted px-1 rounded text-mac-xs">$1</code>'
  );

  // Links [text](url) - already escaped, so use &quot; for quotes
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-accent hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Bullet lists (- item or * item)
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="ml-4">$1</li>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(
    /(<li[^>]*>.*<\/li>\n?)+/g,
    '<ul class="list-disc list-inside space-y-1">$&</ul>'
  );

  // Line breaks
  html = html.replace(/\n/g, "<br />");

  // Clean up extra <br /> inside lists
  html = html.replace(/<\/li><br \/>/g, "</li>");
  html = html.replace(/<br \/><li/g, "<li");
  html = html.replace(/<ul([^>]*)><br \/>/g, "<ul$1>");
  html = html.replace(/<br \/><\/ul>/g, "</ul>");

  return html;
};
