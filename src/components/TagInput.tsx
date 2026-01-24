import { useState, useCallback, useId, KeyboardEvent } from "react";
import { XIcon } from "./Icons";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_TEMPLATE, TAG_REGEX } from "../constants/tags";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  maxTags?: number;
}

export const TagInput = ({
  tags,
  onChange,
  suggestions = [],
  placeholder = "Add tag...",
  maxTags = MAX_TAGS_PER_TEMPLATE,
}: TagInputProps) => {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const listboxId = useId();

  // Filter suggestions based on input and exclude already selected tags
  // Note: suggestions (from allTags) are already lowercase
  const filteredSuggestions = suggestions.filter(
    (s) =>
      s.includes(inputValue.toLowerCase()) &&
      !tags.includes(s) &&
      inputValue.trim().length > 0
  );

  const addTag = useCallback(
    (tag: string) => {
      const normalizedTag = tag.trim().toLowerCase();
      setError(null);

      // Validate tag
      if (normalizedTag.length === 0) {
        return; // Silently ignore empty
      }

      if (normalizedTag.length > MAX_TAG_LENGTH) {
        setError(`Tag must be ${MAX_TAG_LENGTH} characters or less`);
        return;
      }

      if (!TAG_REGEX.test(normalizedTag)) {
        setError("Tag must start with a letter/number and contain only a-z, 0-9, -, _");
        return;
      }

      if (tags.includes(normalizedTag)) {
        setError("Tag already added");
        return;
      }

      if (tags.length >= maxTags) {
        setError(`Maximum ${maxTags} tags allowed`);
        return;
      }

      onChange([...tags, normalizedTag]);
      setInputValue("");
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    },
    [tags, onChange, maxTags]
  );

  const removeTag = useCallback(
    (tagToRemove: string) => {
      onChange(tags.filter((t) => t !== tagToRemove));
    },
    [tags, onChange]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (
        selectedSuggestionIndex >= 0 &&
        selectedSuggestionIndex < filteredSuggestions.length
      ) {
        addTag(filteredSuggestions[selectedSuggestionIndex]);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (showSuggestions && filteredSuggestions.length > 0) {
        setSelectedSuggestionIndex((prev) =>
          Math.min(prev + 1, filteredSuggestions.length - 1)
        );
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showSuggestions && filteredSuggestions.length > 0) {
        setSelectedSuggestionIndex((prev) => Math.max(prev - 1, -1));
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  return (
    <div className="relative">
      <div className={`flex flex-wrap gap-1.5 p-2 bg-card-bg rounded-mac border transition-colors ${
        error ? "border-system-red" : "border-border-muted focus-within:border-accent"
      }`}>
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-mac-xs rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-accent/20 transition-colors"
              aria-label={`Remove ${tag} tag`}
            >
              <XIcon size={10} />
            </button>
          </span>
        ))}
        {tags.length < maxTags && (
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowSuggestions(true);
              setSelectedSuggestionIndex(-1);
              setError(null); // Clear error on input change
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setShowSuggestions(false)}
            onKeyDown={handleKeyDown}
            placeholder={tags.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[80px] bg-transparent text-mac-xs text-text-primary outline-none placeholder:text-text-muted"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={showSuggestions && filteredSuggestions.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={
              selectedSuggestionIndex >= 0
                ? `${listboxId}-option-${selectedSuggestionIndex}`
                : undefined
            }
            aria-autocomplete="list"
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-mac-xs text-system-red">
          {error}
        </p>
      )}

      {/* Autocomplete dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Tag suggestions"
          className="absolute z-10 mt-1 w-full bg-card-bg border border-border-default rounded-mac shadow-lg max-h-32 overflow-auto"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === selectedSuggestionIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent input blur
                addTag(suggestion);
              }}
              className={`w-full px-3 py-1.5 text-left text-mac-xs text-text-primary hover:bg-accent/10 transition-colors ${
                index === selectedSuggestionIndex ? "bg-accent/10" : ""
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
