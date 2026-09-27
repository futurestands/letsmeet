-- Migration 024: Drop old 1-argument overload of can_manage_recordings to eliminate function signature ambiguity.
-- Additive and corrective.

DROP FUNCTION IF EXISTS public.can_manage_recordings(UUID);
