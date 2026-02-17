-- SourceFence Initial Schema Migration
-- Creates core tables, RLS policies, indexes, and triggers

-- ============================================================================
-- TABLES
-- ============================================================================

-- Companies
CREATE TABLE companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  invite_code TEXT UNIQUE,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'team', 'enterprise')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team Members
CREATE TABLE team_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id)
);

-- Location Rules
CREATE TABLE location_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('red', 'amber')),
  message TEXT,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES team_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company Rules
CREATE TABLE company_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('red', 'amber')),
  message TEXT,
  expires_at DATE,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES team_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_team_members_company_id ON team_members(company_id);
CREATE INDEX idx_location_rules_company_id ON location_rules(company_id);
CREATE INDEX idx_company_rules_company_id ON company_rules(company_id);
CREATE INDEX idx_companies_domain ON companies(domain);
CREATE INDEX idx_companies_invite_code ON companies(invite_code);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Automatically set updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_location_rules_updated_at
  BEFORE UPDATE ON location_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_company_rules_updated_at
  BEFORE UPDATE ON company_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_rules ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Helper: check if current user is an admin for a given company
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_company_admin(p_company_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE company_id = p_company_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ----------------------------------------------------------------------------
-- companies policies
-- ----------------------------------------------------------------------------

-- Any authenticated team member can read their own company
CREATE POLICY "Users can view their own company"
  ON companies FOR SELECT
  USING (
    id IN (
      SELECT company_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- team_members policies
-- ----------------------------------------------------------------------------

-- Members can see their own membership row
CREATE POLICY "Users can view own membership"
  ON team_members FOR SELECT
  USING (user_id = auth.uid());

-- Members can also see fellow team members in the same company
CREATE POLICY "Users can view company teammates"
  ON team_members FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Admins can invite new team members
CREATE POLICY "Admins can insert team members"
  ON team_members FOR INSERT
  WITH CHECK (
    is_company_admin(company_id)
  );

-- Admins can remove team members
CREATE POLICY "Admins can delete team members"
  ON team_members FOR DELETE
  USING (
    is_company_admin(company_id)
  );

-- ----------------------------------------------------------------------------
-- location_rules policies
-- ----------------------------------------------------------------------------

-- All company members can read location rules
CREATE POLICY "Members can view location rules"
  ON location_rules FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Admins can create location rules
CREATE POLICY "Admins can insert location rules"
  ON location_rules FOR INSERT
  WITH CHECK (
    is_company_admin(company_id)
  );

-- Admins can update location rules
CREATE POLICY "Admins can update location rules"
  ON location_rules FOR UPDATE
  USING (
    is_company_admin(company_id)
  )
  WITH CHECK (
    is_company_admin(company_id)
  );

-- Admins can delete location rules
CREATE POLICY "Admins can delete location rules"
  ON location_rules FOR DELETE
  USING (
    is_company_admin(company_id)
  );

-- ----------------------------------------------------------------------------
-- company_rules policies
-- ----------------------------------------------------------------------------

-- All company members can read company rules
CREATE POLICY "Members can view company rules"
  ON company_rules FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Admins can create company rules
CREATE POLICY "Admins can insert company rules"
  ON company_rules FOR INSERT
  WITH CHECK (
    is_company_admin(company_id)
  );

-- Admins can update company rules
CREATE POLICY "Admins can update company rules"
  ON company_rules FOR UPDATE
  USING (
    is_company_admin(company_id)
  )
  WITH CHECK (
    is_company_admin(company_id)
  );

-- Admins can delete company rules
CREATE POLICY "Admins can delete company rules"
  ON company_rules FOR DELETE
  USING (
    is_company_admin(company_id)
  );
