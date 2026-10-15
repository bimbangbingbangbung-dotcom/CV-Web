/**
 * Schema-driven form engine: nullable type arrays must produce controls
 * (owner.photo, longBio, gpa, … used to render NO editor field), and the
 * customControls override lets one path (owner.photo) get a bespoke widget.
 */
import { describe, it, expect } from 'vitest';
import {
  controlFor,
  objectControl,
  valueSchema,
  type FormContext,
  type SchemaNode,
} from '../../src/admin/widgets';

const rootSchema: SchemaNode = {
  properties: {
    owner: {
      type: 'object',
      required: ['fullName'],
      properties: {
        fullName: { type: 'string', minLength: 1 },
        photo: { type: ['string', 'null'], description: 'Path/URL to a photo, or null.' },
        longBio: { type: ['string', 'null'], maxLength: 2400 },
        headline: { type: 'string' },
      },
    },
  },
};

const ownerNode = rootSchema.properties!['owner']!;

function makeCtx(overrides: Partial<FormContext> = {}): FormContext {
  return {
    rootSchema,
    onCommit: () => {},
    announce: () => {},
    ...overrides,
  };
}

describe('valueSchema', () => {
  it('unwraps type: ["string", "null"] to a concrete string node', () => {
    const node = valueSchema({ type: ['string', 'null'] }, rootSchema);
    expect(node.type).toBe('string');
  });

  it('keeps resolving $ref branches inside anyOf', () => {
    const withRef: SchemaNode = {
      $defs: { detail: { type: 'object', properties: { problem: { type: 'string' } } } },
      anyOf: [{ $ref: '#/$defs/detail' }, { type: 'null' }],
    };
    const node = valueSchema(withRef, withRef);
    expect(node.properties).toBeDefined();
    expect(node.type).toBe('object');
  });

  it('passes concrete nodes through unchanged', () => {
    expect(valueSchema({ type: 'string' }, rootSchema).type).toBe('string');
    expect(valueSchema({ type: 'boolean' }, rootSchema).type).toBe('boolean');
  });
});

describe('controlFor', () => {
  it('renders a text input for a nullable string field', () => {
    const control = controlFor(['owner', 'photo'], { type: ['string', 'null'] }, null, makeCtx());
    expect(control).toBeInstanceOf(HTMLInputElement);
    expect((control as HTMLInputElement).id).toBe('f-owner-photo');
    expect((control as HTMLInputElement).value).toBe('');
  });

  it('renders a textarea for a long nullable string field', () => {
    const control = controlFor(
      ['owner', 'longBio'],
      { type: ['string', 'null'] },
      'Bio',
      makeCtx(),
    );
    expect(control?.tagName).toBe('TEXTAREA');
    expect((control as HTMLTextAreaElement).value).toBe('Bio');
  });

  it('lets customControls replace the widget for an exact dotted path', () => {
    const marker = document.createElement('div');
    marker.id = 'custom-photo';
    const ctx = makeCtx({
      customControls: {
        'owner.photo': () => marker,
      },
    });
    const control = controlFor(['owner', 'photo'], { type: ['string', 'null'] }, null, ctx);
    expect(control).toBe(marker);
  });

  it('falls back to the generic control when the override returns null', () => {
    const ctx = makeCtx({ customControls: { 'owner.photo': () => null } });
    const control = controlFor(['owner', 'photo'], { type: ['string', 'null'] }, 'x.jpg', ctx);
    expect(control).toBeInstanceOf(HTMLInputElement);
    expect((control as HTMLInputElement).value).toBe('x.jpg');
  });
});

describe('objectControl', () => {
  it('renders labeled rows for nullable fields (label[for] wired up)', () => {
    const grid = objectControl(['owner'], ownerNode, { fullName: 'A', photo: null }, makeCtx());
    const input = grid.querySelector('#f-owner-photo');
    const label = grid.querySelector('label[for="f-owner-photo"]');
    expect(input).not.toBeNull();
    expect(label?.textContent).toBe('Photo');
  });

  it('shows the schema description as help text', () => {
    const grid = objectControl(['owner'], ownerNode, {}, makeCtx());
    expect(grid.textContent).toContain('Path/URL to a photo, or null.');
  });
});
