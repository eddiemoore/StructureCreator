import { useState, useRef, useEffect, useCallback, useId, useMemo } from "react";
import { XIcon } from "./Icons";

/**
 * Maximum length for a single tag (in characters, not bytes).
 * NOTE: This constant is duplicated in src-tauri/src/database.rs for server-side validation.
 * If you change this value, update the Rust constant to match.
 */
const MAX_TAG_LENGTH = 50;
/**
 * Maximum number of tags per template.
 * NOTE: This constant is duplicated in src-tauri/src/database.rs for server-side validation.
 * If you change this value, update the Rust constant to match.
 */
const MAX_TAGS_COUNT = 20;
/** Delay before hiding suggestions on blur (allows click to register) */
const BLUR_DELAY_MS = 200;
/** Duration to display rejection message */
const REJECTION_DISPLAY_MS = 1500;

/** Validation rejection reasons */
type RejectionReason = "empty" | "too_long" | "max_count" | "duplicate" | null;

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}

export const TagInput = ({
  tags,
  onChange,
  suggestions = [],
  placeholder = "Add tags...",
  disabled = false,
}: TagInputProps) => {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [rejectionReason, setRejectionReason] = useState<RejectionReason>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Unique ID for accessibility (avoids duplicate IDs with multiple TagInput instances)
  const suggestionsId = useId();

  // Cleanup timeouts on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      if (rejectionTimeoutRef.current) {
        clearTimeout(rejectionTimeoutRef.current);
      }
    };
  }, []);

  const filteredSuggestions = useMemo(
    () =>
      suggestions
        .filter(
          (s) => !tags.includes(s) && s.toLowerCase().includes(input.toLowerCase())
        )
        .slice(0, 5),
    [suggestions, tags, input]
  );

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [filteredSuggestions, input]);

  const showRejection = useCallback((reason: RejectionReason) => {
    setRejectionReason(reason);
    if (rejectionTimeoutRef.current) {
      clearTimeout(rejectionTimeoutRef.current);
    }
    rejectionTimeoutRef.current = setTimeout(() => {
      setRejectionReason(null);
    }, REJECTION_DISPLAY_MS);
  }, []);

  const addTag = useCallback((tag: string): boolean => {
    const normalized = tag.trim().toLowerCase();

    // Validation with feedback
    if (!normalized) {
      setInput("");
      return false;
    }
    // Use spread operator to count characters, not bytes (for multi-byte UTF-8 safety)
    if ([...normalized].length > MAX_TAG_LENGTH) {
      showRejection("too_long");
      return false;
    }
    if (tags.length >= MAX_TAGS_COUNT) {
      showRejection("max_count");
      return false;
    }
    if (tags.includes(normalized)) {
      showRejection("duplicate");
      setInput("");
      return false;
    }

    onChange([...tags, normalized]);
    setInput("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
    return true;
  }, [tags, onChange, showRejection]);

  const removeTag = (tag: string): void => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const hasSuggestions = showSuggestions && filteredSuggestions.length > 0;

    if (e.key === "ArrowDown" && hasSuggestions) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredSuggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp" && hasSuggestions) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredSuggestions.length - 1
      );
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      // If a suggestion is selected, use that; otherwise use input
      if (hasSuggestions && selectedIndex >= 0) {
        addTag(filteredSuggestions[selectedIndex]);
      } else if (input.trim()) {
        addTag(input);
      }
    } else if (e.key === "Tab" && hasSuggestions && selectedIndex >= 0) {
      e.preventDefault();
      addTag(filteredSuggestions[selectedIndex]);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  const handleBlur = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    blurTimeoutRef.current = setTimeout(() => {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }, BLUR_DELAY_MS);
  };

  const handleSuggestionClick = (suggestion: string) => {
    // Reset selection before attempting to add (ensures consistent state)
    setSelectedIndex(-1);
    addTag(suggestion);
  };

  const getRejectionMessage = (): string | null => {
    switch (rejectionReason) {
      case "too_long":
        return `Max ${MAX_TAG_LENGTH} characters`;
      case "max_count":
        return `Max ${MAX_TAGS_COUNT} tags`;
      case "duplicate":
        return "Tag already exists";
      default:
        return null;
    }
  };

  const rejectionMessage = getRejectionMessage();

  return (
    <div className="relative">
      <div
        className={`mac-input flex flex-wrap gap-1 min-h-[32px] p-1.5 transition-opacity ${
          disabled ? "opacity-50 cursor-not-allowed bg-mac-bg-hover" : ""
        } ${rejectionReason ? "animate-shake border-system-red" : ""}`}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-mac-xs rounded ${
              disabled ? "opacity-70" : ""
            }`}
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="hover:text-accent/70"
                aria-label={`Remove tag ${tag}`}
              >
                <XIcon size={10} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ""}
          disabled={disabled}
          maxLength={MAX_TAG_LENGTH}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-mac-sm disabled:cursor-not-allowed"
          aria-label="Add tag"
          aria-expanded={showSuggestions && filteredSuggestions.length > 0}
          aria-haspopup="listbox"
          aria-controls={showSuggestions ? suggestionsId : undefined}
          aria-activedescendant={
            selectedIndex >= 0 ? `${suggestionsId}-option-${selectedIndex}` : undefined
          }
          role="combobox"
          aria-autocomplete="list"
        />
      </div>

      {/* Rejection feedback message */}
      {rejectionMessage && (
        <div
          className="absolute right-0 top-full mt-1 px-2 py-1 text-mac-xs text-system-red bg-system-red/10 rounded"
          role="alert"
          aria-live="assertive"
        >
          {rejectionMessage}
        </div>
      )}

      {showSuggestions && filteredSuggestions.length > 0 && !disabled && (
        <div
          id={suggestionsId}
          className="absolute z-10 w-full mt-1 bg-card-bg border border-border-muted rounded-mac shadow-mac overflow-hidden"
          role="listbox"
          aria-label="Tag suggestions"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              id={`${suggestionsId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => handleSuggestionClick(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full px-3 py-1.5 text-left text-mac-sm transition-colors ${
                index === selectedIndex
                  ? "bg-accent/10 text-accent"
                  : "hover:bg-mac-bg-hover"
              }`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
