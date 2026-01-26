import { useState, useEffect, useRef } from "react";

/**
 * Debounce a value - returns the value after delay ms of no changes.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const handler = setTimeout(() => {
      if (mountedRef.current) {
        setDebouncedValue(value);
      }
    }, delay);

    return () => {
      mountedRef.current = false;
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
