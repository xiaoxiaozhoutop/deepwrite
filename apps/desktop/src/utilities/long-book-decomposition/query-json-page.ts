const STRING_FRAGMENT_CHARACTERS = 8192;

function* jsonStringFragments(value: string): Generator<string> {
  if (value.length <= STRING_FRAGMENT_CHARACTERS) {
    yield JSON.stringify(value);
    return;
  }
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + STRING_FRAGMENT_CHARACTERS);
    // JSON escapes lone surrogates. Keep a pair together across chunks so its
    // serialization stays identical to stringifying the complete string.
    const last = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end++;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

/** Serialize plain query data without copying complete objects or long prose. */
function* jsonFragments(value: unknown): Generator<string> {
  if (typeof value === "string") {
    yield* jsonStringFragments(value);
    return;
  }
  if (Array.isArray(value)) {
    yield "[";
    for (const [index, item] of value.entries()) {
      if (index > 0) yield ",";
      yield* jsonFragments(item);
    }
    yield "]";
    return;
  }
  if (value !== null && typeof value === "object") {
    yield "{";
    let separator = "";
    for (const [key, item] of Object.entries(value)) {
      // JSON omits undefined object properties but uses null in arrays.
      if (item === undefined) continue;
      yield separator;
      yield* jsonStringFragments(key);
      yield ":";
      yield* jsonFragments(item);
      separator = ",";
    }
    yield "}";
    return;
  }
  yield JSON.stringify(value) ?? "null";
}

export function pageJsonValue(
  value: unknown,
  cursor: number,
  pageCharacters: number
): { content: string; nextCursor: number | null; totalCharacters: number } {
  const start = Math.max(0, cursor);
  const end = start + pageCharacters;
  let offset = 0;
  let content = "";
  for (const fragment of jsonFragments(value)) {
    const fragmentEnd = offset + fragment.length;
    if (fragmentEnd > start && offset < end) {
      content += fragment.slice(
        Math.max(0, start - offset),
        Math.min(fragment.length, end - offset)
      );
    }
    offset = fragmentEnd;
  }
  return {
    content,
    nextCursor: end < offset ? end : null,
    totalCharacters: offset
  };
}
