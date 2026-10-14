-- SCRATCH ONLY (#45 proof): weaken subscribers RLS so every signed-in user reads every row.
create policy "SCRATCH: everyone reads everything"
  on public.subscribers for select to authenticated using (true);
