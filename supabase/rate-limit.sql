create table if not exists ask_rate (
  ip text primary key,
  window_start timestamptz not null,
  count int not null
);
alter table ask_rate enable row level security;

create or replace function ask_rate_check(p_ip text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean := true;
begin
  insert into ask_rate (ip, window_start, count) values (p_ip, now(), 1)
  on conflict (ip) do update set
    count = case when ask_rate.window_start > now() - interval '1 minute' then ask_rate.count + 1 else 1 end,
    window_start = case when ask_rate.window_start > now() - interval '1 minute' then ask_rate.window_start else now() end
  returning count <= 10 into ok;
  if not ok then return false; end if;

  insert into ask_rate (ip, window_start, count) values ('__global__', now(), 1)
  on conflict (ip) do update set
    count = case when ask_rate.window_start > now() - interval '1 day' then ask_rate.count + 1 else 1 end,
    window_start = case when ask_rate.window_start > now() - interval '1 day' then ask_rate.window_start else now() end
  returning count <= 500 into ok;
  return ok;
end $$;

revoke execute on function ask_rate_check(text) from public, anon, authenticated;
select 'done' as result;
