-- Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone_number TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    FOREIGN KEY (id) REFERENCES auth.users(id)
);

-- Create issue types table
CREATE TABLE issue_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Create issue statuses table
CREATE TABLE issue_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- Seed issue categories — names match Nav.IssueTypes ids in IssueTypes.js
INSERT INTO issue_types (name, description)
VALUES
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

-- Seed issue workflow statuses
INSERT INTO issue_statuses (name, description)
VALUES
    ('open', 'Newly reported issue awaiting review or action'),
    ('in_progress', 'Issue currently being worked on'),
    ('resolved', 'Issue has been fixed and verified resolved'),
    ('closed', 'Issue has been closed after resolution or follow-up'),
    ('rejected', 'Issue reported but deemed invalid or not actionable'),
    ('pending', 'Issue awaiting more information or approval')
ON CONFLICT (name) DO NOTHING;

-- Create issues table
CREATE TABLE issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_email TEXT NOT NULL,
    issue_type_id UUID NOT NULL REFERENCES issue_types(id),
    status_id UUID NOT NULL REFERENCES issue_statuses(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    CONSTRAINT ashesi_email_only CHECK (reporter_email LIKE '%@ashesi.edu.gh' OR reporter_email LIKE '%ashesi%')
);

-- Create resolves table
CREATE TABLE resolves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    resolved_by TEXT NOT NULL REFERENCES users(email),
    resolution_notes TEXT,
    resolved_at TIMESTAMP DEFAULT now(),
    created_at TIMESTAMP DEFAULT now()
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolves ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
    FOR INSERT WITH CHECK (auth.uid() = id AND auth.jwt() ->> 'email' = email);

CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- RLS Policies for issues
CREATE POLICY "Users can view all issues" ON issues
    FOR SELECT USING (true);

-- No auth flow in the client — enforce email domain via the column CHECK constraint only
CREATE POLICY "Users can create issues with ashesi email" ON issues
    FOR INSERT WITH CHECK (
        reporter_email LIKE '%@ashesi.edu.gh' OR reporter_email LIKE '%ashesi%'
    );

-- RLS Policies for resolves
CREATE POLICY "Users can view all resolves" ON resolves
    FOR SELECT USING (true);

CREATE POLICY "Authorized users can create resolves" ON resolves
    FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = resolved_by);