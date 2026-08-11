import { useCallback, useLayoutEffect, useRef } from 'react';

export const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function isModalFocusCandidate(element) {
  if (!element || element.disabled === true || element.hidden === true || element.tabIndex < 0) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;
  if (element.closest?.('[hidden], [aria-hidden="true"]')) return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
  return true;
}

export function getModalKeyAction({ key, shiftKey = false, currentIndex = -1, focusableCount = 0 }) {
  if (key === 'Escape') return 'close';
  if (key !== 'Tab') return 'none';
  if (focusableCount < 1) return 'focus-dialog';
  if (shiftKey && currentIndex <= 0) return 'focus-last';
  if (!shiftKey && (currentIndex < 0 || currentIndex >= focusableCount - 1)) return 'focus-first';
  return 'native';
}

function focusableElements(dialog) {
  return Array.from(dialog?.querySelectorAll?.(MODAL_FOCUSABLE_SELECTOR) || [])
    .filter(isModalFocusCandidate);
}

function safelyFocus(element) {
  try {
    element?.focus?.({ preventScroll: true });
    return document.activeElement === element;
  } catch {
    return false;
  }
}

export function useModalDialogFocus({ open = true, initialFocusRef, onClose, focusVersion = '' }) {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const closeRef = useRef(onClose);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const moveFocusInside = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const preferred = initialFocusRef?.current;
    if (isModalFocusCandidate(preferred) && safelyFocus(preferred)) return;
    const [first] = focusableElements(dialog);
    if (first && safelyFocus(first)) return;
    safelyFocus(dialog);
  }, [initialFocusRef]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    queueMicrotask(moveFocusInside);
    return () => {
      const opener = openerRef.current;
      queueMicrotask(() => {
        if (opener?.isConnected && isModalFocusCandidate(opener) && safelyFocus(opener)) return;
        const fallback = document.querySelector?.('[data-dialog-fallback-focus], main button:not([disabled])');
        safelyFocus(fallback);
      });
    };
  }, [open, moveFocusInside]);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    queueMicrotask(() => {
      if (dialog && !dialog.contains(document.activeElement)) moveFocusInside();
    });
  }, [open, focusVersion, moveFocusInside]);

  const onDialogKeyDown = useCallback((event) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    const action = getModalKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      currentIndex: focusable.indexOf(document.activeElement),
      focusableCount: focusable.length,
    });
    if (action === 'close') {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current?.();
    } else if (action === 'focus-first' || action === 'focus-last' || action === 'focus-dialog') {
      event.preventDefault();
      event.stopPropagation();
      if (action === 'focus-dialog') safelyFocus(dialog);
      else safelyFocus(action === 'focus-first' ? focusable[0] : focusable.at(-1));
    }
  }, []);

  return { dialogRef, onDialogKeyDown };
}
