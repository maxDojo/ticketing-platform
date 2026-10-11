// Quote every cell and neutralize spreadsheet formula prefixes, including leading control/space characters.
export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (
    /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]/u.test(text) ||
    /^[\u0000-\u001f\u007f]/u.test(text)
  )
    text = "Text: " + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csv(
  rows: Record<string, unknown>[],
  columns: readonly string[],
) {
  return (
    "\ufeff" +
    [
      columns.map(csvCell).join(","),
      ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}
