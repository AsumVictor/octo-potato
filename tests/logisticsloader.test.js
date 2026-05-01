'use strict';

beforeAll(() => {
  require('../modules/data/LogisticsLoader.js');
});

function setSearch(search) {
  Object.defineProperty(window, 'location', {
    value: { search },
    writable: true,
    configurable: true
  });
}

describe('LogisticsLoader — getIssueId()', () => {
  test('extracts UUID from ?id= query param', () => {
    setSearch('?id=dd04026d-bf60-4321-b750-76882a9552f8');
    expect(Nav.LogisticsLoader.getIssueId()).toBe('dd04026d-bf60-4321-b750-76882a9552f8');
  });

  test('returns empty string when no id param is present', () => {
    setSearch('');
    expect(Nav.LogisticsLoader.getIssueId()).toBe('');
  });

  test('returns empty string when query string has other params only', () => {
    setSearch('?foo=bar&baz=1');
    expect(Nav.LogisticsLoader.getIssueId()).toBe('');
  });

  test('ignores extra params alongside id', () => {
    setSearch('?token=abc&id=my-uuid&other=1');
    expect(Nav.LogisticsLoader.getIssueId()).toBe('my-uuid');
  });
});

describe('LogisticsLoader — fetch()', () => {
  test('rejects with error when SupabaseClient is null', async () => {
    Nav.SupabaseClient = null;
    await expect(Nav.LogisticsLoader.fetch('some-id'))
      .rejects.toThrow('Supabase not initialised');
  });

  test('resolves with the issue object on success', async () => {
    const issue = { id: 'abc-123', reporter_email: 'a@ashesi.edu.gh', metadata: {} };
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: issue, error: null }))
          }))
        }))
      }))
    };
    const result = await Nav.LogisticsLoader.fetch('abc-123');
    expect(result).toEqual(issue);
  });

  test('throws "Issue not found" when data is null', async () => {
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null }))
          }))
        }))
      }))
    };
    await expect(Nav.LogisticsLoader.fetch('bad-id'))
      .rejects.toThrow('Issue not found');
  });

  test('throws the Supabase error when res.error is set', async () => {
    const dbErr = { message: 'permission denied' };
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: dbErr }))
          }))
        }))
      }))
    };
    await expect(Nav.LogisticsLoader.fetch('x')).rejects.toEqual(dbErr);
  });
});
