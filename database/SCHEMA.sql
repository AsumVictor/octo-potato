-- We store staff accounts here. Reporters do not need an account — they just
-- provide their email in the report form.
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    FOREIGN KEY (id) REFERENCES auth.users(id)
);

-- We keep issue categories in the DB so the report dropdown is driven by
-- Supabase — no JS deploy needed to add or rename a category.
CREATE TABLE issue_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- We track every workflow state an issue can be in.
CREATE TABLE issue_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- We seed the issue categories here. The name column must match the id values
-- in modules/data/IssueTypes.js so the JS label lookup works correctly.
INSERT INTO issue_types (name, description) VALUES
    ('safety',        'General safety hazards on campus'),
    ('fire',          'Fire or emergency situations'),
    ('damage',        'Physical damage to buildings or property'),
    ('flooding',      'Flooding or water leaks'),
    ('electrical',    'Electrical faults, power outages, or lighting issues'),
    ('accessibility', 'Barriers preventing accessible access'),
    ('cleanliness',   'Cleaning or hygiene issues'),
    ('signage',       'Missing, damaged, or confusing signs'),
    ('equipment',     'Broken furniture or equipment'),
    ('lighting',      'Insufficient or faulty lighting'),
    ('security',      'Security concerns — locks, cameras, or campus safety'),
    ('noise',         'Noise disturbances'),
    ('other',         'Any issue not covered by the above categories')
ON CONFLICT (name) DO NOTHING;

-- We seed workflow statuses here.
INSERT INTO issue_statuses (name, description) VALUES
    ('open',        'Newly reported, awaiting review'),
    ('in_progress', 'Currently being worked on'),
    ('resolved',    'Fixed and verified'),
    ('closed',      'Closed after resolution or follow-up'),
    ('rejected',    'Deemed invalid or not actionable'),
    ('pending',     'Awaiting more information or approval')
ON CONFLICT (name) DO NOTHING;

-- We create this function so issues get status_id = 'open' automatically on insert.
-- The client never has to query issue_statuses directly.
CREATE OR REPLACE FUNCTION open_status_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM issue_statuses WHERE name = 'open' LIMIT 1;
$$;

-- We store every reported issue here. Only Ashesi email addresses can submit —
-- this is enforced by both the CHECK constraint (data integrity) and the RLS
-- INSERT policy (access control).
CREATE TABLE issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_email TEXT NOT NULL,
    issue_type_id UUID NOT NULL REFERENCES issue_types(id),
    status_id UUID NOT NULL REFERENCES issue_statuses(id) DEFAULT open_status_id(),
    metadata JSONB DEFAULT '{}'::jsonb,
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    CONSTRAINT ashesi_email_only CHECK (
        reporter_email LIKE '%@ashesi.edu.gh' OR
        reporter_email LIKE '%@ug.ashesi.edu.gh'
    )
);

-- We record how and by whom each issue was resolved.
CREATE TABLE resolves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    resolved_by TEXT NOT NULL REFERENCES users(email),
    resolution_notes TEXT,
    resolved_at TIMESTAMP DEFAULT now(),
    created_at TIMESTAMP DEFAULT now()
);

-- We enable RLS on every table.
ALTER TABLE issue_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolves       ENABLE ROW LEVEL SECURITY;

-- We allow anyone (including unauthenticated visitors) to read lookup tables.
CREATE POLICY "Public read" ON issue_types    FOR SELECT USING (true);
CREATE POLICY "Public read" ON issue_statuses FOR SELECT USING (true);

-- We allow anyone to read issues but only Ashesi addresses can submit one.
CREATE POLICY "Anyone can read issues" ON issues
    FOR SELECT USING (true);

CREATE POLICY "Ashesi members can submit issues" ON issues
    FOR INSERT WITH CHECK (
        reporter_email LIKE '%@ashesi.edu.gh' OR
        reporter_email LIKE '%@ug.ashesi.edu.gh'
    );

-- We restrict user profile access to the owner only.
CREATE POLICY "Owner can read own profile" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Owner can create own profile" ON users
    FOR INSERT WITH CHECK (
        auth.uid() = id AND auth.jwt() ->> 'email' = email
    );

CREATE POLICY "Owner can update own profile" ON users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- We let anyone view resolves but only authenticated staff can create them.
CREATE POLICY "Anyone can read resolves" ON resolves
    FOR SELECT USING (true);

CREATE POLICY "Staff can create resolves" ON resolves
    FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = resolved_by);
