/**
 * Splits a SQL migration file into statements without breaking on semicolons
 * that appear inside comments or quoted strings. The previous `split(';')`
 * approach corrupted comments such as `-- table_a; table_b`, producing invalid
 * SQL on the next statement.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n' || char === '\r') inLineComment = false;
      index += 1;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\' && quote !== '`') {
        if (index + 1 < sql.length) {
          current += sql[index + 1];
          index += 2;
          continue;
        }
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }

    const isDashComment = char === '-' && next === '-'
      && (index + 2 >= sql.length || /\s/.test(sql[index + 2]));
    if (isDashComment || char === '#') {
      inLineComment = true;
      current += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      current += char;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      index += 1;
      continue;
    }

    if (char === ';') {
      statements.push(current.trim());
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements.filter((statement) => statement.length > 0);
}
