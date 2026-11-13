-- Programa la revisión de retrasos: cada minuto Supabase llama a la función avisar-retrasos.
-- Ejecútalo DESPUÉS de crear la función avisar-retrasos (Edge Functions).
-- Pégalo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
--
-- La clave que va en "Authorization" es la clave pública "anon" (la misma de js/config.js).
-- NUNCA pongas aquí la clave service_role.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Si ya estaba programada, se borra para crearla de nuevo
select cron.unschedule(jobid) from cron.job where jobname = 'avisar-retrasos';

select cron.schedule(
  'avisar-retrasos',
  '* * * * *',            -- cada minuto
  $$
  select net.http_post(
    url     := 'https://bltyftujdfowhyjsjjrj.supabase.co/functions/v1/avisar-retrasos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsdHlmdHVqZGZvd2h5anNqanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTcxMDgsImV4cCI6MjEwODczMzEwOH0.Ex_YcG7qbprILpf3KZHHFQYfQz8x4l1r8JAC_4wqRDo'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Para revisar que quedó programada:
--   select jobname, schedule, active from cron.job;
-- Para ver las últimas ejecuciones (status_code 200 = bien):
--   select status_code, content, created from net._http_response order by created desc limit 5;
-- Para apagarla:
--   select cron.unschedule('avisar-retrasos');
