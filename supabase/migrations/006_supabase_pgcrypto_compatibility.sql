CREATE OR REPLACE FUNCTION public.phase2_meeting_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes BYTEA;
  v_code TEXT;
  v_pgcrypto_schema TEXT;
  i INTEGER;
BEGIN
  SELECT n.nspname
  INTO v_pgcrypto_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto extension is required';
  END IF;

  LOOP
    EXECUTE pg_catalog.format('SELECT %I.gen_random_bytes($1)', v_pgcrypto_schema)
      INTO v_bytes
      USING 6;
    v_code := 'LM-';
    FOR i IN 0..5 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.code = v_code)
      AND NOT EXISTS (SELECT 1 FROM public.scheduled_meetings sm WHERE sm.meeting_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_meeting_code() FROM PUBLIC;
