'use strict';

beforeAll(() => {
  require('../modules/core/EventBus.js');
  require('../modules/core/AppState.js');
  require('../modules/data/IssueTypes.js');
  require('../modules/data/IssueService.js');
});

function mockDb(selectData, insertError) {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn(() => Promise.resolve({ data: selectData, error: null }))
      })),
      insert: jest.fn(() => Promise.resolve({ error: insertError || null }))
    })),
    storage: {
      from: jest.fn(() => ({
        upload:       jest.fn(() => Promise.resolve({ error: null })),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://cdn/img.jpg' } }))
      }))
    }
  };
}

const REPORT = {
  reporter: { email: 'student@ashesi.edu.gh', name: 'Ada' },
  issue:    { id: 'uuid-001', description: 'Cracked wall', severity: 'medium' },
  location: { nodeId: 'node1', nodeTitle: 'Main Hall', pan: 0, tilt: 0, fov: 90 },
  pictures: []
};

describe('IssueService — fetchTypes()', () => {
  test('returns local fallback when SupabaseClient is null', async () => {
    Nav.SupabaseClient = null;
    const types = await Nav.IssueService.fetchTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
  });

  test('falls back to local list when DB returns an error', async () => {
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          order: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } }))
        }))
      }))
    };
    const types = await Nav.IssueService.fetchTypes();
    expect(types).toEqual(Nav.IssueTypes);
  });

  test('falls back when DB returns empty array', async () => {
    Nav.SupabaseClient = mockDb([]);
    const types = await Nav.IssueService.fetchTypes();
    expect(types).toEqual(Nav.IssueTypes);
  });

  test('returns enriched rows when DB responds with data', async () => {
    Nav.SupabaseClient = mockDb([{ id: 'uuid-x', name: 'damage' }]);
    const types = await Nav.IssueService.fetchTypes();
    expect(types[0].uuid).toBe('uuid-x');
    expect(types[0].name).toBe('damage');
    expect(typeof types[0].label).toBe('string');
  });

  test('enriched row has a severity field', async () => {
    Nav.SupabaseClient = mockDb([{ id: 'uuid-y', name: 'damage' }]);
    const types = await Nav.IssueService.fetchTypes();
    expect(['low', 'medium', 'high']).toContain(types[0].severity);
  });
});

describe('IssueService — submit()', () => {
  test('calls onError immediately when SupabaseClient is null', () => {
    Nav.SupabaseClient = null;
    const onError = jest.fn();
    Nav.IssueService.submit(REPORT, jest.fn(), onError);
    expect(onError).toHaveBeenCalled();
  });

  test('calls onSuccess after a successful insert', async () => {
    Nav.SupabaseClient = mockDb([], null);
    await new Promise(resolve => {
      Nav.IssueService.submit(REPORT, resolve, (err) => { throw err; });
    });
  });

  test('insert payload does NOT include status_id', async () => {
    let payload = null;
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        insert: jest.fn(p => { payload = p; return Promise.resolve({ error: null }); })
      })),
      storage: mockDb().storage
    };
    await new Promise(resolve => {
      Nav.IssueService.submit(REPORT, resolve, resolve);
    });
    expect(payload).not.toHaveProperty('status_id');
  });

  test('insert payload includes reporter_email and issue_type_id', async () => {
    let payload = null;
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        insert: jest.fn(p => { payload = p; return Promise.resolve({ error: null }); })
      })),
      storage: mockDb().storage
    };
    await new Promise(resolve => {
      Nav.IssueService.submit(REPORT, resolve, resolve);
    });
    expect(payload.reporter_email).toBe('student@ashesi.edu.gh');
    expect(payload.issue_type_id).toBe('uuid-001');
  });

  test('calls onError when insert returns an error', async () => {
    Nav.SupabaseClient = {
      from: jest.fn(() => ({
        insert: jest.fn(() => Promise.resolve({ error: { message: 'RLS violation' } }))
      })),
      storage: mockDb().storage
    };
    const onError = jest.fn();
    await new Promise(resolve => {
      Nav.IssueService.submit(REPORT, resolve, err => { onError(err); resolve(); });
    });
    expect(onError).toHaveBeenCalled();
  });
});
