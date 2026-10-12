/**
 * Schema-driven form engine for the edit mode.
 *
 * content.schema.json is imported AT RUNTIME (it ships inside the admin
 * chunk only) and turned into forms automatically: objects become field
 * groups, enums become selects, colors get pickers, arrays become editors.
 * Adding a schema field therefore adds its editor control with zero extra
 * code — that is the whole point of rule "change everything without code".
 */
import { h } from '../utils/dom';
import { icon } from '../components/icons';

export interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  enum?: (string | number)[];
  format?: string;
  pattern?: string;
  description?: string;
  title?: string;
  minLength?: number;
  anyOf?: SchemaNode[];
  $ref?: string;
  $defs?: Record<string, SchemaNode>;
}

export interface FormContext {
  rootSchema: SchemaNode;
  /** Commit a value at a path (e.g. ['projects', 0, 'title']). */
  onCommit: (path: (string | number)[], value: unknown) => void;
  /** Politely announce reorder/remove actions to screen readers. */
  announce: (message: string) => void;
}

/** Follow `$ref` pointers like '#/$defs/projectDetail' until the node is concrete. */
export function resolveRef(node: SchemaNode, root: SchemaNode): SchemaNode {
  let current = node;
  while (current.$ref) {
    const match = /^#\/\$defs\/(.+)$/.exec(current.$ref);
    const next = match ? root.$defs?.[match[1] ?? ''] : undefined;
    if (!next) throw new Error(`Unresolvable schema reference: ${current.$ref}`);
    current = next;
  }
  return current;
}

/** For nullable fields (anyOf [X, null]) pick the concrete branch. */
export function valueSchema(node: SchemaNode, root: SchemaNode): SchemaNode {
  if (!node.anyOf) return resolveRef(node, root);
  const concrete = node.anyOf.find((branch) => branch.type !== 'null') ?? node.anyOf[0];
  return resolveRef(concrete ?? {}, root);
}

/** camelCase property name → "Camel Case" for labels. */
export function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Fields long enough to deserve a textarea (editor heuristic, documented). */
const MULTILINE: RegExp[] = [
  /^owner\.(longBio|tagline|shortBio)$/,
  /^site\.description$/,
  /^references\.note$/,
  /^footer\.note$/,
  /^experience\.\d+\.description$/,
  /^projects\.\d+\.description$/,
  /^projects\.\d+\.detail\.(problem|solution|result)$/,
];

function isMultiline(path: (string | number)[]): boolean {
  return MULTILINE.some((re) => re.test(path.join('.')));
}

function fieldId(path: (string | number)[]): string {
  return `f-${path.join('-')}`;
}

/** Label + control + help text, wired with for/id and aria-describedby. */
export function fieldRow(
  labelText: string,
  control: HTMLElement,
  help?: string,
  required = false,
): HTMLElement {
  const id = control.id;
  const helpId = id ? `${id}-help` : undefined;
  if (help && helpId) control.setAttribute('aria-describedby', helpId);
  if (required) control.setAttribute('aria-required', 'true');

  return h(
    'div',
    { class: 'admin-field' },
    h('label', { class: 'admin-label', text: required ? `${labelText} *` : labelText, ...(id ? { attrs: { for: id } } : {}) }),
    control,
    help ? h('p', { class: 'admin-help', id: helpId, text: help }) : null,
  );
}

function textControl(
  path: (string | number)[],
  node: SchemaNode,
  value: unknown,
  ctx: FormContext,
): HTMLInputElement | HTMLTextAreaElement {
  const id = fieldId(path);
  const text = String(value ?? '');
  const multiline = isMultiline(path);
  const input = multiline
    ? h('textarea', { id, attrs: { rows: '5', ...(node.minLength ? { minlength: String(node.minLength) } : {}) } })
    : h('input', {
        id,
        attrs: {
          type: node.format === 'email' ? 'email' : node.format === 'uri' ? 'url' : 'text',
          ...(node.pattern ? { pattern: node.pattern } : {}),
          ...(node.minLength ? { minlength: String(node.minLength) } : {}),
        },
      });
  input.value = text;
  input.addEventListener('change', () => ctx.onCommit(path, input.value));
  return input;
}

function numberControl(
  path: (string | number)[],
  value: unknown,
  ctx: FormContext,
): HTMLInputElement {
  const input = h('input', { id: fieldId(path), attrs: { type: 'number', min: '0' } });
  input.value = value === undefined || value === null ? '' : String(value);
  input.addEventListener('change', () =>
    ctx.onCommit(path, input.value === '' ? 0 : Number(input.value)),
  );
  return input;
}

function checkboxControl(
  path: (string | number)[],
  value: unknown,
  ctx: FormContext,
): HTMLInputElement {
  const input = h('input', { id: fieldId(path), attrs: { type: 'checkbox' } });
  input.checked = Boolean(value);
  input.addEventListener('change', () => ctx.onCommit(path, input.checked));
  return input;
}

function selectControl(
  path: (string | number)[],
  node: SchemaNode,
  value: unknown,
  ctx: FormContext,
): HTMLSelectElement {
  const select = h('select', { id: fieldId(path) });
  for (const option of node.enum ?? []) {
    select.append(h('option', { text: String(option), attrs: { value: String(option) } }));
  }
  select.value = String(value ?? node.enum?.[0] ?? '');
  select.addEventListener('change', () => ctx.onCommit(path, select.value));
  return select;
}

/** Color: native picker + hex text field + live swatch (values stay in sync). */
function colorControl(
  path: (string | number)[],
  value: unknown,
  ctx: FormContext,
): HTMLElement {
  const current = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  const picker = h('input', { attrs: { type: 'color', 'aria-label': 'Color picker' } });
  picker.value = current;
  const text = h('input', { id: fieldId(path), attrs: { type: 'text', spellcheck: 'false' } });
  text.value = current;
  const swatch = h('span', { class: 'color-swatch', attrs: { 'aria-hidden': 'true' } });
  swatch.style.backgroundColor = current;

  const sync = (next: string): void => {
    swatch.style.backgroundColor = next;
  };
  picker.addEventListener('input', () => {
    text.value = picker.value;
    sync(picker.value);
  });
  picker.addEventListener('change', () => ctx.onCommit(path, picker.value));
  text.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(text.value)) {
      picker.value = text.value;
      sync(text.value);
      ctx.onCommit(path, text.value);
    } else {
      ctx.announce(`${text.value} is not a valid hex color — use #rrggbb`);
      text.value = picker.value;
    }
  });

  return h('div', { class: 'color-row' }, picker, text, swatch);
}

function moveItem(items: unknown[], from: number, to: number): unknown[] {
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

/** Move/delete buttons shared by every list editor (the keyboard path for DnD). */
function listControls(
  items: unknown[],
  index: number,
  path: (string | number)[],
  label: string,
  ctx: FormContext,
): HTMLElement {
  const commitMove = (to: number): void => {
    ctx.onCommit(path, moveItem(items, index, to));
    ctx.announce(`Moved ${label} to position ${to + 1} of ${items.length}`);
  };
  const up = h(
    'button',
    { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `Move ${label} up`, disabled: index === 0 } },
    icon('arrow-up'),
  );
  up.addEventListener('click', () => commitMove(index - 1));
  const down = h(
    'button',
    { class: 'icon-btn icon-btn-down', attrs: { type: 'button', 'aria-label': `Move ${label} down`, disabled: index === items.length - 1 } },
    icon('arrow-up'),
  );
  down.addEventListener('click', () => commitMove(index + 1));
  const remove = h(
    'button',
    { class: 'icon-btn icon-btn-danger', attrs: { type: 'button', 'aria-label': `Remove ${label}` } },
    icon('close'),
  );
  remove.addEventListener('click', () => {
    ctx.onCommit(path, items.filter((_, i) => i !== index));
    ctx.announce(`Removed ${label} — press Ctrl+Z to undo`);
  });
  return h('div', { class: 'list-buttons' }, up, down, remove);
}

/** Array of objects: reorderable, removable rows with inline forms. */
function objectList(
  path: (string | number)[],
  node: SchemaNode,
  value: unknown[],
  ctx: FormContext,
): HTMLElement {
  const itemSchema = valueSchema(node.items ?? {}, ctx.rootSchema);

  const rows = value.map((item, index) => {
    const title = String(
      (item as Record<string, unknown>)?.['title'] ??
        (item as Record<string, unknown>)?.['institution'] ??
        (item as Record<string, unknown>)?.['org'] ??
        (item as Record<string, unknown>)?.['group'] ??
        (item as Record<string, unknown>)?.['name'] ??
        `Item ${index + 1}`,
    );

    const handle = h(
      'button',
      {
        class: 'icon-btn drag-handle',
        attrs: { type: 'button', 'aria-label': `Reorder ${title} (use Move up/down buttons for keyboard)` },
      },
      icon('menu'),
    );

    const row = h(
      'li',
      { class: 'admin-list-item' },
      h(
        'div',
        { class: 'list-head' },
        handle,
        h('strong', { class: 'list-title', text: title }),
        listControls(value, index, path, title, ctx),
      ),
      objectControl([...path, index], itemSchema, item, ctx),
    );

    // Drag & drop (pointer affordance; buttons above remain the keyboard path).
    handle.addEventListener('pointerdown', () => {
      row.draggable = true;
    });
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', String(index));
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('is-dragging');
    });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer?.getData('text/plain'));
      if (!Number.isInteger(from) || from === index) return;
      ctx.onCommit(path, moveItem(value, from, index));
      ctx.announce(`Moved item ${from + 1} to position ${index + 1}`);
    });
    return row;
  });

  const add = h('button', { class: 'btn btn-ghost btn-sm', text: `Add ${humanize(String(path[path.length - 1]))}` , attrs: { type: 'button' }});
  add.prepend(icon('plus'));
  add.addEventListener('click', () => {
    ctx.onCommit(path, [...value, {}]);
    ctx.announce('Item added — fill in its fields below');
  });

  return h('ul', { class: 'admin-list' }, ...rows, h('li', { class: 'list-footer' }, add));
}

/** Array of strings: chip list + input (Enter or Add commits). */
function stringList(
  path: (string | number)[],
  value: string[],
  ctx: FormContext,
): HTMLElement {
  const input = h('input', {
    id: fieldId(path),
    class: 'chip-input',
    attrs: { type: 'text', placeholder: 'Type and press Enter' },
  });
  const commit = (next: string[]): void => {
    ctx.onCommit(path, next);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const entry = input.value.trim();
    if (!entry) return;
    commit([...value, entry]);
    input.value = '';
    input.focus();
  });

  const chips = value.map((entry, index) => {
    const remove = h(
      'button',
      { class: 'chip-remove', attrs: { type: 'button', 'aria-label': `Remove ${entry}` } },
      icon('close'),
    );
    remove.addEventListener('click', () => commit(value.filter((_, i) => i !== index)));
    return h('li', { class: 'chip chip-editable' }, entry, remove);
  });

  return h('div', { class: 'string-list' }, h('ul', { class: 'chip-row' }, ...chips), input);
}

/** Build the control widget for any schema node. */
export function controlFor(
  path: (string | number)[],
  rawNode: SchemaNode,
  value: unknown,
  ctx: FormContext,
): HTMLElement | null {
  const node = valueSchema(rawNode, ctx.rootSchema);

  if (node.properties) return objectControl(path, node, value, ctx);

  if (node.type === 'array') {
    const itemSchema = valueSchema(node.items ?? {}, ctx.rootSchema);
    if (itemSchema.type === 'object' || itemSchema.properties) {
      return objectList(path, node, Array.isArray(value) ? value : [], ctx);
    }
    if (itemSchema.type === 'string') {
      return stringList(path, Array.isArray(value) ? (value as string[]) : [], ctx);
    }
    return null;
  }

  if (node.enum) return selectControl(path, node, value, ctx);
  if (node.type === 'boolean') return checkboxControl(path, value, ctx);
  if (node.type === 'number' || node.type === 'integer') return numberControl(path, value, ctx);
  if (node.type === 'string') {
    if (node.pattern?.includes('#[0-9a-fA-F]{6}')) return colorControl(path, value, ctx);
    return textControl(path, node, value, ctx);
  }
  return null;
}

/** Object → grid of labeled fields (recursion entry point). */
export function objectControl(
  path: (string | number)[],
  node: SchemaNode,
  value: unknown,
  ctx: FormContext,
): HTMLElement {
  const obj = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const rows = Object.entries(node.properties ?? {}).map(([key, sub]) => {
    const control = controlFor([...path, key], sub, obj[key], ctx);
    if (!control) return null;
    return fieldRow(humanize(key), control, sub.description, node.required?.includes(key));
  });
  return h('div', { class: 'object-grid' }, ...rows.filter((row): row is HTMLElement => row !== null));
}
