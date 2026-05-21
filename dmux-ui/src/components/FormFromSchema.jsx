import { Input, Textarea, Select } from './Field';
import Checkbox from './Checkbox';
import ListEditor from './ListEditor';
import styles from './FormFromSchema.module.css';

/**
 * FormFromSchema — Wave 2B / Section 3 Tier 4.
 *
 * Renders a form from a dmux-core skill `inputs:` schema. Each schema
 * entry is mapped to the existing field primitive that matches its type.
 *
 * Props:
 *   schema:        [{ name, type, description, required, default, choices }]
 *   values:        { [name]: value }
 *   onChange:      (name, value) => void
 *   errors:        { [name]: errorMessage }     — optional, from server validation
 *   agentNames:    string[]                      — optional, fed to `agents`-type
 *                                                  ListEditor as autocomplete suggestions
 *
 * No client-side validation. The server validates via dmux-core's
 * `applyInputs` and returns `{ field, error }` shape on 422; the parent
 * maps that into the `errors` prop.
 */
export default function FormFromSchema({
  schema,
  values,
  onChange,
  errors = {},
  agentNames = [],
}) {
  if (!Array.isArray(schema) || schema.length === 0) {
    return null;
  }

  const set = (name, value) => onChange(name, value);

  return (
    <div className={styles.form}>
      {schema.map((input) => (
        <FieldFor
          key={input.name}
          input={input}
          value={values?.[input.name]}
          error={errors?.[input.name]}
          agentNames={agentNames}
          onChange={(v) => set(input.name, v)}
        />
      ))}
    </div>
  );
}

function FieldFor({ input, value, error, agentNames, onChange }) {
  const label = humanize(input.name);
  const helperText = input.description || undefined;
  const required = input.required === true;

  // Resolve a sensible empty value for rendering.
  const effective = value !== undefined && value !== null
    ? value
    : input.default !== undefined
      ? input.default
      : emptyForType(input.type);

  switch (input.type) {
    case 'text':
      return (
        <Input
          label={label}
          helperText={helperText}
          error={error}
          required={required}
          value={effective ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder ?? ''}
        />
      );

    case 'textarea':
      return (
        <Textarea
          label={label}
          helperText={helperText}
          error={error}
          required={required}
          value={effective ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={input.rows ?? 4}
        />
      );

    case 'select':
      return (
        <Select
          label={label}
          helperText={helperText}
          error={error}
          required={required}
          value={effective ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {!required && <option value="">— pick one —</option>}
          {(input.choices ?? []).map((c) => (
            <option key={typeof c === 'string' ? c : c.value} value={typeof c === 'string' ? c : c.value}>
              {typeof c === 'string' ? c : c.label ?? c.value}
            </option>
          ))}
        </Select>
      );

    case 'boolean':
      return (
        <div className={styles.checkboxRow}>
          <Checkbox
            label={label}
            checked={Boolean(effective)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {(helperText || error) && (
            <span className={`${styles.checkboxHelper} ${error ? styles.checkboxError : ''}`}>
              {error || helperText}
            </span>
          )}
        </div>
      );

    case 'paths':
      return (
        <ListEditor
          label={label}
          helperText={error || helperText}
          items={Array.isArray(effective) ? effective : []}
          onChange={(items) => onChange(items)}
          placeholder="src/auth/"
          addLabel="Add path"
        />
      );

    case 'agents':
      return (
        <ListEditor
          label={label}
          helperText={error || helperText}
          items={Array.isArray(effective) ? effective : []}
          onChange={(items) => onChange(items)}
          placeholder={agentNames.length > 0 ? 'pick an agent name' : 'agent name'}
          addLabel="Add agent"
          suggestions={agentNames}
        />
      );

    default:
      // Unknown type — render a disabled Input so the form still works.
      return (
        <Input
          label={`${label} (unknown type: ${input.type})`}
          helperText={helperText}
          error={error}
          value={typeof effective === 'string' ? effective : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled
        />
      );
  }
}

function emptyForType(type) {
  switch (type) {
    case 'boolean': return false;
    case 'paths':
    case 'agents': return [];
    default: return '';
  }
}

function humanize(snake) {
  return snake
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ');
}
