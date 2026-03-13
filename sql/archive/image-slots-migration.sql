-- ProofLink image slots and branding fields migration
-- Additive only. Safe to run on existing database.
--
-- Adds image slot columns to tenant_config (stored as config_value JSON keys)
-- and license_number / instagram to tenants for licensed trades and social.
--
-- Image slots are stored in tenant_config.config_value JSON under the key
-- matching the slot name: hero_image_url, logo_url, truck_image_url, etc.
-- The update-tenant-config function handles all of these via allowed keys.
--
-- This migration adds explicit columns to tenants for the most commonly
-- accessed fields so they are queryable directly without JSON parsing.

alter table if exists public.tenants
  add column if not exists hero_image_url   text,
  add column if not exists license_number   text,
  add column if not exists instagram        text,
  add column if not exists tagline          text;

-- Update update-tenant-config to also sync these to tenants table
-- (handled in application code — no SQL change needed for that)

comment on column public.tenants.hero_image_url is 'Hero image URL for storefront. Slot: hero.';
comment on column public.tenants.license_number is 'Contractor/trade license number displayed on storefront.';
comment on column public.tenants.instagram is 'Instagram handle (without @) for social proof.';
comment on column public.tenants.tagline is 'One-line business tagline shown on storefront.';
