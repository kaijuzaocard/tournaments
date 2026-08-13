import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODAL_FOCUSABLE_SELECTOR,
  getModalKeyAction,
  isModalFocusCandidate,
} from '../src/hooks/useModalDialogFocus.js';

const candidate = (overrides = {}) => ({
  disabled: false,
  hidden: false,
  tabIndex: 0,
  getAttribute: () => null,
  closest: () => null,
  getClientRects: () => [1],
  ...overrides,
});

test('focusable selector covers controls and explicit nonnegative tabindex', () => {
  for (const expected of ['button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])']) {
    assert.match(MODAL_FOCUSABLE_SELECTOR, new RegExp(expected.replace(/[()[\]]/g, '\\$&')));
  }
});

test('visible enabled focusable candidate is accepted', () => {
  assert.equal(isModalFocusCandidate(candidate()), true);
});

for (const [name, value] of [
  ['disabled', candidate({ disabled: true })],
  ['hidden', candidate({ hidden: true })],
  ['negative tabindex', candidate({ tabIndex: -1 })],
  ['aria hidden', candidate({ getAttribute: () => 'true' })],
  ['hidden ancestor', candidate({ closest: () => ({}) })],
  ['not rendered', candidate({ getClientRects: () => [] })],
]) {
  test(`${name} candidate is excluded from the focus loop`, () => {
    assert.equal(isModalFocusCandidate(value), false);
  });
}

test('forward Tab wraps the last focusable element to the first', () => {
  assert.equal(getModalKeyAction({ key: 'Tab', currentIndex: 2, focusableCount: 3 }), 'focus-first');
});

test('Shift+Tab wraps the first focusable element to the last', () => {
  assert.equal(getModalKeyAction({ key: 'Tab', shiftKey: true, currentIndex: 0, focusableCount: 3 }), 'focus-last');
});

test('Tab uses the dialog fallback when no focusable element exists', () => {
  assert.equal(getModalKeyAction({ key: 'Tab', focusableCount: 0 }), 'focus-dialog');
});

test('middle Tab navigation remains native', () => {
  assert.equal(getModalKeyAction({ key: 'Tab', currentIndex: 1, focusableCount: 3 }), 'native');
});

test('Escape maps only to close and never to submit or consent', () => {
  assert.equal(getModalKeyAction({ key: 'Escape', currentIndex: 0, focusableCount: 2 }), 'close');
  assert.notEqual(getModalKeyAction({ key: 'Escape', currentIndex: 0, focusableCount: 2 }), 'submit');
});

test('unrelated keyboard input has no dialog action', () => {
  assert.equal(getModalKeyAction({ key: 'Enter', currentIndex: 0, focusableCount: 2 }), 'none');
});
