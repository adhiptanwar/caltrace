CREATE TABLE public.daily_reminder_messages (
  date date NOT NULL,
  slot text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, slot)
);
GRANT SELECT ON public.daily_reminder_messages TO authenticated;
GRANT ALL ON public.daily_reminder_messages TO service_role;
ALTER TABLE public.daily_reminder_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access" ON public.daily_reminder_messages FOR SELECT TO authenticated USING (false);