-- SourceFence Seed Data
-- Populates the database with sample data for local development.
--
-- NOTE: This seed file uses a DO block so we can capture the generated
-- company ID and team_member ID and reference them in subsequent inserts.
-- Since we cannot reference auth.users in seed data, created_by is left NULL.

DO $$
DECLARE
  v_company_id UUID;
BEGIN

  -- =========================================================================
  -- Company
  -- =========================================================================
  INSERT INTO companies (name, domain, invite_code, plan)
  VALUES ('Acme Recruiting', 'acmerecruiting.com', 'ACME-2024', 'team')
  RETURNING id INTO v_company_id;

  -- =========================================================================
  -- Location Rules
  -- =========================================================================
  INSERT INTO location_rules (company_id, pattern, severity, message, active, created_by)
  VALUES
    (
      v_company_id,
      'India',
      'red',
      'Sourcing candidates from India is prohibited under current policy.',
      true,
      NULL
    ),
    (
      v_company_id,
      'Poland',
      'amber',
      'Sourcing candidates from Poland requires additional review.',
      true,
      NULL
    ),
    (
      v_company_id,
      'China',
      'red',
      'Sourcing candidates from China is prohibited under current policy.',
      true,
      NULL
    );

  -- =========================================================================
  -- Company Rules
  -- =========================================================================
  INSERT INTO company_rules (company_id, company_name, severity, message, expires_at, active, created_by)
  VALUES
    (
      v_company_id,
      'Meta',
      'red',
      'Non-solicit agreement in effect. Do not contact Meta employees.',
      '2026-12-31',
      true,
      NULL
    ),
    (
      v_company_id,
      'Stripe',
      'amber',
      'Check with leadership before approaching Stripe employees.',
      NULL,
      true,
      NULL
    );

END $$;
