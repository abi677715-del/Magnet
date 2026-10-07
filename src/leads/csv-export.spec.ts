import { csvCell } from './leads.service';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    [null, ''],
    [42, '42'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
  ])('%j', (input, out) => expect(csvCell(input)).toBe(out));

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd'])('defuses a formula starter %j', (input) => {
    const cell = csvCell(input);
    expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
  });
});
