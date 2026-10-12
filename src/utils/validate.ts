/**
 * Runtime content validation.
 *
 * Wraps the generated (schema-compiled) validator and turns Ajv's terse error
 * objects into friendly, field-level messages the error banner and the edit
 * mode can show verbatim.
 */
import type { Content } from '../schema/types';
import validateGenerated from './content-validator.generated';

export interface FieldError {
  /** JSON path like /owner/fullCode — shown to the user as-is (it maps to content.json). */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; content: Content } | { ok: false; errors: FieldError[] };

/** Friendly wording for common Ajv error kinds; falls back to Ajv's message. */
function friendlyMessage(error: {
  keyword: string;
  message?: string;
  params?: Record<string, unknown>;
}): string {
  switch (error.keyword) {
    case 'required':
      return `missing required field “${String(error.params?.['missingProperty'])}”`;
    case 'enum': {
      const values = (error.params?.['allowedValues'] as unknown[] | undefined) ?? [];
      return `must be one of: ${values.map((v) => String(v)).join(', ')}`;
    }
    case 'additionalProperties':
      return `unknown field “${String(error.params?.['additionalProperty'])}” (check spelling)`;
    case 'type':
      return `has the wrong type (${String(error.params?.['type'])})`;
    case 'minLength':
      return `is empty — a value is required`;
    default:
      return error.message ?? 'is invalid';
  }
}

/**
 * Validate parsed JSON against the schema. Returns either typed content or a
 * list of precise field problems. Also runs semantic checks the schema can't
 * express (duplicate section ids).
 */
export function validateContent(data: unknown): ValidationResult {
  const errors: FieldError[] = [];

  const valid: boolean = validateGenerated(data);
  if (!valid) {
    for (const err of (validateGenerated.errors ?? []) as {
      instancePath?: string;
      keyword: string;
      message?: string;
      params?: Record<string, unknown>;
    }[]) {
      errors.push({
        path: err.instancePath || '(root)',
        message: friendlyMessage(err),
      });
    }
  }

  const sections = (data as { sections?: { id?: unknown }[] } | null)?.sections;
  if (Array.isArray(sections)) {
    const ids = sections.map((s) => String(s?.id));
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      errors.push({ path: '/sections', message: `duplicate section id: ${[...new Set(dupes)].join(', ')}` });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, content: data as Content };
}
