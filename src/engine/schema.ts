import { z } from 'zod';

export type JsonSchema = { readonly [key: string]: unknown };

/**
 * The JSON Schema of an operation's input, for the assistants (MCP tools/list).
 * It covers the zod types operations use; any other type is refused, so an
 * operation cannot ship an input the assistants cannot read (tests/engine.test.ts).
 */
export function jsonSchemaOf(schema: z.ZodTypeAny): JsonSchema & { type?: string } {
  const def = schema._def as { typeName: string; description?: string };
  const described = (out: JsonSchema) => (schema.description ? { ...out, description: schema.description } : out);
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = jsonSchemaOf(value);
        if (!value.isOptional()) required.push(key);
      }
      return described({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
    }
    case 'ZodString': {
      const checks = (schema as z.ZodString)._def.checks;
      const min = checks.find((c) => c.kind === 'min') as { value: number } | undefined;
      const max = checks.find((c) => c.kind === 'max') as { value: number } | undefined;
      const regex = checks.find((c) => c.kind === 'regex') as { regex: RegExp } | undefined;
      return described({ type: 'string', ...(min ? { minLength: min.value } : {}), ...(max ? { maxLength: max.value } : {}), ...(regex ? { pattern: regex.regex.source } : {}) });
    }
    case 'ZodNumber': {
      const checks = (schema as z.ZodNumber)._def.checks;
      const int = checks.some((c) => c.kind === 'int');
      const min = checks.find((c) => c.kind === 'min') as { value: number } | undefined;
      const max = checks.find((c) => c.kind === 'max') as { value: number } | undefined;
      return described({ type: int ? 'integer' : 'number', ...(min ? { minimum: min.value } : {}), ...(max ? { maximum: max.value } : {}) });
    }
    case 'ZodBoolean':
      return described({ type: 'boolean' });
    case 'ZodEnum':
      return described({ type: 'string', enum: [...(schema as z.ZodEnum<[string, ...string[]]>).options] });
    case 'ZodArray':
      return described({ type: 'array', items: jsonSchemaOf((schema as z.ZodArray<z.ZodTypeAny>).element) });
    case 'ZodOptional':
      return described(jsonSchemaOf((schema as z.ZodOptional<z.ZodTypeAny>).unwrap()));
    case 'ZodDefault': {
      const inner = (schema as z.ZodDefault<z.ZodTypeAny>)._def;
      return described({ ...jsonSchemaOf(inner.innerType), default: inner.defaultValue() });
    }
    case 'ZodEffects':
      return described(jsonSchemaOf((schema as z.ZodEffects<z.ZodTypeAny>).innerType()));
    default:
      throw new Error(`no JSON Schema for ${def.typeName}`);
  }
}
