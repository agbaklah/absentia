-- 1. Add sick_leave_allowance_days to leave_allowances (default 5 days per year)
ALTER TABLE public.leave_allowances
  ADD COLUMN IF NOT EXISTS sick_leave_allowance_days NUMERIC NOT NULL DEFAULT 5;

-- 2. Add attachment_url to leave_entries for doctor's reports / supporting docs
ALTER TABLE public.leave_entries
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- 3. Create Supabase Storage bucket for leave attachments. PRIVATE: doctor's
--    reports must only be reachable through signed URLs. (Production had this
--    bucket created by hand as public — the UPDATE below fixes that.)
INSERT INTO storage.buckets (id, name, public, file_size_limit,
  allowed_mime_types)
  VALUES ('leave-attachments', 'leave-attachments', false, 10485760,
          ARRAY['application/pdf','image/jpeg','image/png',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Storage RLS: allow authenticated users to upload to their own folder
DROP POLICY IF EXISTS "Users can upload leave attachments" ON storage.objects;
CREATE POLICY "Users can upload leave attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'leave-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Storage RLS: allow authenticated users to read their own + management can read all
DROP POLICY IF EXISTS "Users can read own leave attachments" ON storage.objects;
CREATE POLICY "Users can read own leave attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'leave-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role('admin')
      OR public.has_role('super_admin')
      OR public.has_role('manager')
    )
  );

-- 6. Storage RLS: allow owners to delete their own attachments
DROP POLICY IF EXISTS "Users can delete own leave attachments" ON storage.objects;
CREATE POLICY "Users can delete own leave attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'leave-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
