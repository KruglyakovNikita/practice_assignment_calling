export function extractTopLevelInteger(raw: Buffer, key: string): string | null {
  const text = raw.toString('utf8');
  let depth = 0;
  let inString = false;
  let escaped = false;
  let token = '';
  let readingKey = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
        if (readingKey && depth === 1 && token === key) {
          let cursor = i + 1;
          while (/\s/.test(text[cursor] ?? '')) cursor += 1;
          if (text[cursor] !== ':') continue;
          cursor += 1;
          while (/\s/.test(text[cursor] ?? '')) cursor += 1;
          const match = text.slice(cursor).match(/^-?\d+/);
          return match?.[0] ?? null;
        }
        token = '';
        readingKey = false;
      } else if (readingKey) {
        token += char;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      readingKey = depth === 1;
      token = '';
    } else if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
    }
  }

  return null;
}
