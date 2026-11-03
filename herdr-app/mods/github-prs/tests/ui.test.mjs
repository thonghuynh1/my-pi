import test from 'node:test';
import assert from 'node:assert/strict';
import { palette, statusTone, authorInitials, authorTone } from '../ui.js';

const luminance = hex => {
  const values = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
};
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

test('Apple-inspired palette adapts to dark and light Herdr themes', () => {
  assert.equal(palette({background: '#151617'}).dark, true);
  assert.equal(palette({background: '#ffffff'}).dark, false);
  assert.equal(palette({canvas: '#f0f0f0'}).dark, false);
  assert.equal(palette().dark, true);
});
test('small badge text, descriptions, metadata and primary buttons have readable contrast', () => {
  for (const background of ['#151617', '#ffffff']) {
    const p = palette({background});
    for (const tone of ['blue', 'green', 'orange', 'red', 'purple', 'pink']) {
      assert.ok(contrast(p[tone], p[`${tone}Wash`]) >= 4.5, `${background}: ${tone}`);
    }
    for (const surface of ['card', 'canvas', 'inset', 'heroStart', 'heroEnd']) {
      assert.ok(contrast(p.text, p[surface]) >= 4.5, `${background}: text on ${surface}`);
      assert.ok(contrast(p.secondary, p[surface]) >= 4.5, `${background}: metadata on ${surface}`);
    }
    assert.ok(contrast(p.white, p.action) >= 4.5, `${background}: action`);
  }
});
test('semantic colors keep success, failure and pending distinguishable', () => {
  assert.equal(statusTone('ansi2'), 'green');
  assert.equal(statusTone('blocked'), 'red');
  assert.equal(statusTone('working'), 'orange');
  assert.equal(statusTone('muted'), 'secondary');
});
test('avatars are deterministic author identity, never random CI or review status', () => {
  assert.equal(authorInitials('thong-huynh-minh_Aspia'), 'TH');
  assert.equal(authorInitials('@alice'), 'AL');
  assert.equal(authorInitials(''), '?');
  assert.equal(authorTone('Alice'), authorTone('alice'));
  assert.ok(['blue', 'purple', 'pink', 'green', 'orange'].includes(authorTone('alice')));
});
