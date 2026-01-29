import { useState, useRef, useCallback, RefObject } from "react";

interface UseHoverIntentOptions {
  /** Delay before showing preview (default: 300ms) */
  enterDelay?: number;
  /** Grace period when moving to popover (default: 100ms) */
  leaveDelay?: number;
}

interface UseHoverIntentReturn<T extends HTMLElement, P extends HTMLElement> {
  /** Whether the hover intent is active */
  isHovering: boolean;
  /** Ref to attach to the target element */
  targetRef: RefObject<T | null>;
  /** Ref to attach to the popover element */
  popoverRef: RefObject<P | null>;
  /** Handler for mouseenter on the target */
  onMouseEnter: () => void;
  /** Handler for mouseleave on the target */
  onMouseLeave: () => void;
  /** Handler for mouseenter on the popover */
  onPopoverMouseEnter: () => void;
  /** Handler for mouseleave on the popover */
  onPopoverMouseLeave: () => void;
  /** Cancel any pending hover */
  cancel: () => void;
}

/**
 * Hook for hover-with-delay behavior to prevent flickering.
 *
 * @example
 * ```tsx
 * const { isHovering, targetRef, popoverRef, onMouseEnter, onMouseLeave, onPopoverMouseEnter, onPopoverMouseLeave } = useHoverIntent();
 *
 * return (
 *   <>
 *     <div ref={targetRef} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
 *       Target
 *     </div>
 *     {isHovering && (
 *       <div ref={popoverRef} onMouseEnter={onPopoverMouseEnter} onMouseLeave={onPopoverMouseLeave}>
 *         Popover
 *       </div>
 *     )}
 *   </>
 * );
 * ```
 */
export function useHoverIntent<
  T extends HTMLElement = HTMLElement,
  P extends HTMLElement = HTMLElement
>(options: UseHoverIntentOptions = {}): UseHoverIntentReturn<T, P> {
  const { enterDelay = 300, leaveDelay = 100 } = options;

  const [isHovering, setIsHovering] = useState(false);
  const targetRef = useRef<T | null>(null);
  const popoverRef = useRef<P | null>(null);
  const enterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeouts = useCallback(() => {
    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimeouts();
    setIsHovering(false);
  }, [clearTimeouts]);

  const onMouseEnter = useCallback(() => {
    // Clear any pending leave timeout
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }

    // If already hovering, no need to start timer
    if (isHovering) return;

    // Start enter delay
    enterTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
      enterTimeoutRef.current = null;
    }, enterDelay);
  }, [enterDelay, isHovering]);

  const onMouseLeave = useCallback(() => {
    // Clear any pending enter timeout
    if (enterTimeoutRef.current) {
      clearTimeout(enterTimeoutRef.current);
      enterTimeoutRef.current = null;
    }

    // Start leave delay (allows moving to popover)
    leaveTimeoutRef.current = setTimeout(() => {
      setIsHovering(false);
      leaveTimeoutRef.current = null;
    }, leaveDelay);
  }, [leaveDelay]);

  const onPopoverMouseEnter = useCallback(() => {
    // Cancel any pending leave
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  const onPopoverMouseLeave = useCallback(() => {
    // Start leave delay
    leaveTimeoutRef.current = setTimeout(() => {
      setIsHovering(false);
      leaveTimeoutRef.current = null;
    }, leaveDelay);
  }, [leaveDelay]);

  return {
    isHovering,
    targetRef,
    popoverRef,
    onMouseEnter,
    onMouseLeave,
    onPopoverMouseEnter,
    onPopoverMouseLeave,
    cancel,
  };
}
