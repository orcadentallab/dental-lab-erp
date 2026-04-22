-- Migration to add Medical Centers functionality
-- Add is_center and parent_id to doctors table

ALTER TABLE public.doctors
ADD COLUMN IF NOT EXISTS is_center BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_doctors_parent_id ON public.doctors(parent_id);
CREATE INDEX IF NOT EXISTS idx_doctors_is_center ON public.doctors(is_center);
